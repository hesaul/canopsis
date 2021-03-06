/*
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
*/
Ext.define('widgets.diagram.diagram' , {
	extend: 'canopsis.lib.view.cwidget',

	alias: 'widget.diagram',

	logAuthor: '[diagram]',

	options: {},
	chartTitle: null,
	chart: undefined,
	serie: undefined,

	//Default Options
	max: undefined,
	other_label: 'Free',

	backgroundColor: '#FFFFFF',
	borderColor: '#FFFFFF',
	borderWidth: 0,

	exporting_enabled: false,

	title_fontSize: 15,

	pie_size: 60,
	legend_verticalAlign: 'bottom',
	legend_align: 'center',
	legend_layout: 'horizontal',
	legend_backgroundColor: null,
	legend_borderColor: '#909090',
	legend_borderWidth: 1,
	legend_fontSize: 12,
	legend_fontColor: '#3E576F',

    labels: false,
    gradientColor: false,

	interval: global.commonTs.hours,
	aggregate_method: 'LAST',
	aggregate_interval: 0,
	aggregate_max_points: 1,

	nb_node: 0,
	hide_other_column: false,

	diagram_type: 'pie',

	nameInLabelFormatter: false,
	pctInLabel: true,

	haveCounter: false,

	labelFormatter: function() {
		var me = this.series.chart.options.cwidget;

		var prefix = "";

		if (me.nameInLabelFormatter)
			if (this.x)
				prefix = '<b>' + this.x + ':</b> '
			else
				prefix = '<b>' + this.point.metric + ':</b> '

		if (me.pctInLabel && this.percentage != undefined)
			return prefix + rdr_humanreadable_value(this.percentage, "%");
		else
			return prefix + rdr_humanreadable_value(this.y, this.point.bunit);
	},

	initComponent: function() {
		this.backgroundColor	= check_color(this.backgroundColor);
		this.borderColor	= check_color(this.borderColor);
		this.legend_fontColor	= check_color(this.legend_fontColor);
		this.legend_borderColor = check_color(this.legend_borderColor);
		this.legend_backgroundColor	= check_color(this.legend_backgroundColor);

		//search counter
		for (var i = 0; i < this.nodes.length; i++) {
			var node = this.nodes[i];
			if (node['type'] && node['type'] == 'COUNTER')
				this.haveCounter = true;
		}

		this.nodesByID = parseNodes(this.nodes);
		this.nb_node = Ext.Object.getSize(this.nodesByID);

		log.debug('nodesByID:', this.logAuthor);
		log.dump(this.nodesByID);

		//Set title
		if (this.autoTitle) {
			this.setchartTitle();
			this.title = '';
		}else {
			if (! this.border) {
				this.chartTitle = this.title;
				this.title = '';
			}
		}

		this.callParent(arguments);
	},

	afterContainerRender: function() {
		log.debug('Initialize Pie', this.logAuthor);

		// Clean this.nodes
		if (this.nodes)
			this.processNodes();

		this.setOptions();
		this.createChart();

		this.ready();
	},

	setchartTitle: function() {
		var title = '';
		if (this.nb_node == 1) {
			var component = this.nodes[0].dn[0];
			var source_type = this.nodes[0].source_type;

			if (source_type == 'resource') {
				var resource = this.nodes[0].dn[1];
				title = resource + ' ' + _('on') + ' ' + component;
			}else {
				title = component;
			}
		}
		this.chartTitle = title;
	},

	setOptions: function() {
		this.options = {
			cwidget: this,
			chart: {
				renderTo: this.wcontainerId,
				defaultSeriesType: 'pie',
				height: this.getHeight(),
				reflow: false,
				animation: false,
				borderColor: this.borderColor,
				borderWidth: this.borderWidth,
				backgroundColor: this.backgroundColor,
				inverted: (this.diagram_type == 'column') ? this.verticalDisplay : false
			},
			exporting: {
				enabled: false
			},
			colors: [],
			plotOptions: {
				pie: {
					allowPointSelect: true,
					cursor: 'pointer',
					dataLabels: {
						enabled: this.labels,
                        color: '#000000',
                        connectorColor: '#000000',
                        formatter: this.labelFormatter
					},
					showInLegend: true,
					animation: false,
					size: this.pie_size + '%'
				},
				column: {
					animation: false,
					dataLabels: {
						enabled: this.labels,
                        color: '#000000',
                        connectorColor: '#000000',
                        formatter: this.labelFormatter
					}
				}
			},
			tooltip: {
				formatter: this.tooltip_formatter
			},
			title: {
				text: this.chartTitle,
				floating: true,
				style: {
					fontSize: this.title_fontSize
				}
			},
			exporting: {
				enabled: this.exporting_enabled,
				filename: this.chartTitle,
				type: 'image/svg+xml',
				url: '/export_svg',
				buttons: {
					exportButton: {
						enabled: true,
						menuItems: null,
						onclick: function() {
							this.exportChart();
						}
					},
					printButton: {
						enabled: false
					}
				}
			},
			symbols: [],
			credits: {
				enabled: false
			},
			legend: {
				enabled: (this.diagram_type == 'column') ? false : this.legend,
				verticalAlign: this.legend_verticalAlign,
				align: this.legend_align,
				layout: this.legend_layout,
				backgroundColor: this.legend_backgroundColor,
				borderWidth: this.legend_borderWidth,
				borderColor: this.legend_borderColor,
				itemStyle: {
					fontSize: this.legend_fontSize,
					color: this.legend_fontColor
				}
			},
			series: [],
			xAxis: {
				title: { text: null },
				labels: {enabled: (this.nameInLabelFormatter) ? false : true}
			},
			yAxis: {
				title: { text: null },
				labels: {formatter: this.y_formatter}
			}
		};
		/*
		if(this.diagram_type == 'column'){
			this.options.yAxis = [{
				title: { text: null },
				labels: {
					formatter: this.y_formatter
				}
			}]
		}
		*/

		//specifique options to add
		if (this.exportMode) {
			this.options.plotOptions.pie.enableMouseTracking = false;
			this.options.plotOptions.tooltip = {};
			this.options.plotOptions.pie.shadow = false;
		}
	},

	createChart: function() {
		this.chart = new Highcharts.Chart(this.options);
		Highcharts.setOptions({
			lang: {
				months: [_('January'), _('February'), _('March'), _('April'), _('May'), _('June'), _('July'), _('August'), _('September'), _('October'), _('November'), _('December')],
				weekdays: [_('Sunday'), _('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'), _('Friday'), _('Saturday')],
				shortMonths: [_('Jan'), _('Feb'), _('Mar'), _('Apr'), _('May'), _('Jun'), _('Jul'), _('Aug'), _('Sept'), _('Oct'), _('Nov'), _('Dec')]
			}
		});
	},

	processNodes: function() {
		var post_params = [];
		for (var i = 0; i < this.nodes.length; i++) {
			post_params.push({
				id: this.nodes[i].id,
				metrics: this.nodes[i].metrics
			});
		}
		this.post_params = {
			'nodes': Ext.JSON.encode(post_params),
			'aggregate_method' : this.aggregate_method,
			'aggregate_max_points': 1,
			'aggregate_timemodulation': false
		};

		if (this.aggregate_interval)
			this.post_params['aggregate_interval'] = this.aggregate_interval;
	},

	doRefresh: function(from, to) {
		// Get last point only
		if (this.time_window && from == 0)
			from = to - this.time_window;
		else if (! this.haveCounter)
			from = to;

		log.debug('Get values from ' + new Date(from) + ' to ' + new Date(to), this.logAuthor);

		if (this.nodes) {
			if (this.nodes.length != 0) {

				var url = '/perfstore/values/' + parseInt(from / 1000) + '/' + parseInt(to / 1000);

				Ext.Ajax.request({
					url: url,
					scope: this,
					params: this.post_params,
					method: 'POST',
					success: function(response) {
						var data = Ext.JSON.decode(response.responseText);
						data = data.data;
						this.onRefresh(data);
					},
					failure: function(result, request) {
						log.error('Ajax request failed ... (' + request.url + ')', this.logAuthor);
					}
				});
			} else {
				log.debug('No nodes specified', this.logAuthor);
			}
		}
	},

	onRefresh: function(data) {
		// s to ms
		/*
		if(data.values && (data.values.length>0))
			for(var i =0; i < data.values.length; i++)
				data.values[i][0] = data.values[i][0]*1000
		*/

		if (this.chart && data.length != 0) {
			var myEl = this.getEl();
			if (myEl && myEl.isMasked && !this.isDisabled())
				myEl.unmask();

			// Remove old series
			this.removeSerie();

			serie = this.getSerie(data);

			var other_unit = '';

			for (var i = 0; i < data.length; i++) {
				var info = data[i];

				var node = this.nodesByID[info['node']];

				//custom metric
				if (node.extra_field && node.extra_field.label) {
					data[i]['metric'] = node.extra_field.label;
				}

				var metric = info['metric'];

				var value = undefined;

				if (info['values'].length >= 1)
					value = info['values'][0][1];

				//------------------

				var unit = info['bunit'];
				var max = info['max'];

				if (max == null)
					max = this.max;

				if (unit == '%' && ! max)
					max = 100;

				var metric_name = metric;

				var colors = global.curvesCtrl.getRenderColors(metric_name, i);
				var curve = global.curvesCtrl.getRenderInfo(metric_name);

				// Set Label
				var label = undefined;
				if (!label && curve)
					label = curve.get('label');
				if (! label)
					label = metric_name;

				metric = label;

				var metric_long_name = '<b>' + label + '</b>';

				if (unit) {
					metric_long_name += ' (' + unit + ')';
					other_unit += ' (' + unit + ')';
				}

				var _color = colors[0];
				if (node.extra_field && node.extra_field.curve_color)
					_color = node.extra_field.curve_color;

				if (this.gradientColor)
					var color = this.getGradientColor(_color);
				else
					var color = _color;

				serie.data.push({ id: metric, name: metric_long_name, metric: metric, y: value, color: color, bunit: unit });

			}

			if (this.setAxis && this.diagram_type == 'column')
				this.setAxis(serie.data);

			if (data.length == 1 && !this.hide_other_column && this.diagram_type == 'pie') {
				var other_label = '<b>' + this.other_label + '</b>' + other_unit;
				var colors = global.curvesCtrl.getRenderColors(this.other_label, 1);
				if (this.gradientColor)
					var _color = this.getGradientColor(colors[0]);
				else
					var _color = colors[0];
				serie.data.push({ id: 'pie_other', name: other_label, metric: this.other_label, y: max - value, color: _color });
			}

			if (serie.data) {
				this.serie = serie;
				this.displaySerie();
			}else {
				log.debug('No data to display', this.logAuthor);
			}
		}else {
			this.getEl().mask(_('No data on interval'));
		}

	},

	removeSerie: function() {
		var serie = this.chart.get('serie');
		if (serie)
			serie.destroy();
	},

	displaySerie: function() {
		if (this.serie)
			this.chart.addSeries(Ext.clone(this.serie));
	},

	reloadSerie: function() {
		this.removeSerie();
		this.displaySerie();
	},

	getSerie: function(data) {
		var bunit = undefined;
		if (data.length != 0)
			for (var i = 0; i < data.length; i++)
				if (data[i].bunit)
					bunit = data[i].bunit;

		return {
					id: 'serie',
					type: this.diagram_type,
					shadow: false,
					data: [],
					bunit: bunit
				};
	},

	getGradientColor: function(color) {
		return {
			radialGradient: { cx: 0.5, cy: 0.3, r: 0.7 },
			stops: [
				[0, color],
				[1, Highcharts.Color(color).brighten(-0.3).get('rgb')]
			]
		};
	},

	onResize: function() {
		log.debug('onRezize', this.logAuthor);
		if (this.chart) {
			this.chart.setSize(this.getWidth(), this.getHeight() , false);
			this.reloadSerie();
		}
	},

	tooltip_formatter: function() {

		var formatter = function(options, value) {
			if (options.invert)
				value = - value;

			value = rdr_humanreadable_value(value, options.bunit);
			return '<b>' + options.metric + '</b>: ' + value;
		};

		var s = '';

		if (this['points']) {
			// Shared
			$.each(this.points, function(i, point) {
				s += formatter(point.options, point.y);
			});
		} else {
			s += formatter(this.point.options, this.y);
		}
		return s;
	},

	setAxis: function(data) {
		var metrics = [];
		for (var i = 0; i < data.length; i++)
			if (data[i].metric)
				metrics.push(data[i].metric);

		this.chart.xAxis[0].setCategories(metrics, false);
	},

	y_formatter: function() {
		if (this.chart.series.length) {
			var bunit = this.chart.series[0].options.bunit;
			return rdr_humanreadable_value(this.value, bunit);
		}
		return this.value;
	}

});
