#!/usr/bin/env python
#--------------------------------
# Copyright (c) 2011 "Capensis" [http://www.capensis.com]
#
# This file is part of Canopsis.
#
# Canopsis is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# Canopsis is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with Canopsis.  If not, see <http://www.gnu.org/licenses/>.
# ---------------------------------

import multiprocessing
import time
import Queue
import logging
import os, sys
from cinit import cinit
import traceback
import cevent

import itertools

class cengine(multiprocessing.Process):

	def __init__(self,
			next_amqp_queues=[],
			next_balanced=False,
			name="worker1",
			beat_interval=60,
			logging_level=logging.INFO,
			exchange_name='amq.direct',
			routing_keys=[]):
		
		multiprocessing.Process.__init__(self)
		
		self.logging_level = logging_level
	
		self.signal_queue = multiprocessing.Queue(maxsize=5)

		self.RUN = True
		
		self.name = name
		
		self.amqp_queue = "Engine_%s" % name
		self.routing_keys = routing_keys
		self.exchange_name = exchange_name
		
		self.perfdata_retention = 3600

		self.next_amqp_queues = next_amqp_queues
		self.get_amqp_queue = itertools.cycle(self.next_amqp_queues)
		
		## Get from internal or external queue
		self.next_balanced = next_balanced
		
		init 	= cinit()
		
		self.logger = init.getLogger(name, logging_level=self.logging_level)
		
		# Log in file
		self.logger.addHandler(logging.FileHandler(filename=os.path.expanduser("~/var/log/engines/%s.log" % name)))	
		
		self.counter_error = 0
		self.counter_event = 0
		self.counter_worktime = 0
		
		self.thd_warn_sec_per_evt = 0.6
		self.thd_crit_sec_per_evt = 0.9
		
		self.beat_interval = beat_interval
		self.beat_last = time.time()
		
		self.create_queue =  True

		self.send_stats_event = True

		self.rk_on_error = []
				
		self.logger.info("Engine initialised")
		
	def create_amqp_queue(self):
		self.amqp.add_queue(
			queue_name=self.amqp_queue,
			routing_keys=self.routing_keys,
			callback=self.on_amqp_event,
			exchange_name=self.exchange_name,
			no_ack=True,
			exclusive=False,
			auto_delete=False
		)
	
	def pre_run(self):
		pass
		
	def post_run(self):
		pass
	
	def run(self):
		def ready():
			self.logger.info(" + Ready!")
			
		self.logger.info("Start Engine with pid %s" % (os.getpid()))
		
		from camqp import camqp
		
		self.amqp = camqp(logging_level=logging.INFO, logging_name="%s-amqp" % self.name, on_ready=ready)
		
		if self.create_queue:
			self.create_amqp_queue()
		
		self.amqp.start()
		
		self.pre_run()
		
		while self.RUN:
			# Internal signals
			try:
				signal = self.signal_queue.get_nowait()
				self.logger.debug("Signal: %s" % signal)
				if signal == "STOP":
					self.RUN = False
			except Queue.Empty:
				pass
				
			# Beat
			if self.beat_interval:
				now = time.time()
				if now > (self.beat_last + self.beat_interval):
					self._beat()						
					self.beat_last = now

			try:
				time.sleep(1)
			except Exception as err:
				self.logger.error("Error in break time: %s" % err)
				self.RUN = False

		self.post_run()
		
		self.logger.info("Stop Engine")
		self.stop()
		self.logger.info("End of Engine")
		
	def on_amqp_event(self, event, msg):
		try:
			self._work(event, msg)
		except Exception as err:
			if event['rk'] not in self.rk_on_error:
				self.logger.error(err)
				self.logger.error("Impossible to deal with: %s" % event)
				self.rk_on_error.append(event['rk'])

			self.next_queue(event)
	
	def _work(self, event, msg=None, *args, **kargs):
		start = time.time()
		error = False
		try:
			wevent = self.work(event, msg, *args, **kargs)
			
			#self.logger.debug("Forward event '%s' to next engines" % event['rk'])

			if isinstance(wevent, dict):
				self.next_queue(wevent)
			else:
				self.next_queue(event)
					
		except Exception, err:
			error = True
			self.logger.error("Worker raise exception: %s" % err)
			traceback.print_exc(file=sys.stdout)
			#self.logger.error("Event: %s" % event)
	
		if error:
			self.counter_error +=1
			
		elapsed = time.time() - start

		if elapsed > 3:
			self.logger.warning("Elapsed time %.2f seconds" % elapsed)

		self.counter_event += 1
		self.counter_worktime += elapsed
		
	def work(self, event, amqp_msg):
		return event
		
	def next_queue(self, event):
		if self.next_balanced:
			queue_name = self.get_amqp_queue.next()
			if queue_name:
				self.amqp.publish(event, queue_name, "amq.direct")

		else:	
			for queue_name in self.next_amqp_queues:
				#self.logger.debug(" + Forward via amqp to '%s'" % engine.amqp_queue)
				self.amqp.publish(event, queue_name, "amq.direct")

	def _beat(self):
		self.logger.debug("Beat: %s event(s), %s error" % (self.counter_event, self.counter_error))
			
		evt_per_sec = 0
		sec_per_evt = 0
		
		if self.counter_event:
			evt_per_sec = float(self.counter_event) / self.beat_interval
			self.logger.debug(" + %0.2f event(s)/seconds" % evt_per_sec)
		
		if self.counter_worktime and self.counter_event:
			sec_per_evt = self.counter_worktime / self.counter_event
			self.logger.debug(" + %0.5f seconds/event" % sec_per_evt)
		
		## Submit event
		if self.send_stats_event and self.counter_event != 0:
			state = 0
			
			if sec_per_evt > self.thd_warn_sec_per_evt:
				state = 1
				
			if sec_per_evt > self.thd_crit_sec_per_evt:
				state = 2
			
			perf_data_array = [
				{'retention': self.perfdata_retention, 'metric': 'cps_evt_per_sec', 'value': round(evt_per_sec,2), 'unit': 'evt' },
				{'retention': self.perfdata_retention, 'metric': 'cps_sec_per_evt', 'value': round(sec_per_evt,5), 'unit': 's',
					'warn': self.thd_warn_sec_per_evt,
					'crit': self.thd_crit_sec_per_evt
				},
			]

			self.logger.debug(" + State: %s" % state)
			
			event = cevent.forger(
				connector = "cengine",
				connector_name = "engine",
				event_type = "check",
				source_type="resource",
				resource=self.amqp_queue,
				state=state,
				state_type=1,
				output="%0.2f evt/sec, %0.5f sec/evt" % (evt_per_sec, sec_per_evt),
				perf_data_array=perf_data_array
			)
			
			rk = cevent.get_routingkey(event)
			self.amqp.publish(event, rk, self.amqp.exchange_name_events)
		

		self.counter_error = 0
		self.counter_event = 0
		self.counter_worktime = 0

		try:
			self.beat()
		except Exception, err:
			self.logger.error("Beat raise exception: %s" % err)
			traceback.print_exc(file=sys.stdout)
				
	def beat(self):
		pass
			
	def stop(self):
		self.RUN = False
		
		# cancel self consumer
		self.amqp.cancel_queues()
					
		self.amqp.stop()
		self.amqp.join()
		self.signal_queue.empty()
		del self.signal_queue
		self.logger.debug(" + Stopped")
