define(function (require) {
  return ['AggConfigs', function () {
    var _ = require('lodash');
    var sinon = require('test_utils/auto_release_sinon');

    var Vis;
    var Registry;
    var AggConfig;
    var AggConfigs;
    var SpiedAggConfig;
    var indexPattern;

    beforeEach(module('kibana'));
    beforeEach(inject(function (Private) {
      // replace the AggConfig module with a spy
      var RealAggConfigPM = require('components/vis/_agg_config');
      AggConfig = Private(RealAggConfigPM);
      Private.stub(RealAggConfigPM, sinon.spy(AggConfig));

      // load main deps
      Vis = Private(require('components/vis/vis'));
      SpiedAggConfig = Private(require('components/vis/_agg_config'));
      AggConfigs = Private(require('components/vis/_agg_configs'));
      Registry = require('utils/registry/registry');
      indexPattern = Private(require('fixtures/stubbed_logstash_index_pattern'));
    }));

    it('extends Registry', function () {
      var ac = new AggConfigs();
      expect(ac).to.be.a(Registry);
    });

    describe('constructor', function () {
      it('handles passing just a vis', function () {
        var vis = new Vis(indexPattern, {
          type: 'histogram',
          aggs: []
        });

        var ac = new AggConfigs(vis);
        expect(ac).to.have.length(0);
      });

      it('converts configStates into AggConfig objects if they are not already', function () {
        var vis = new Vis(indexPattern, {
          type: 'histogram',
          aggs: []
        });

        var ac = new AggConfigs(vis, [
          {
            type: 'date_histogram',
            schema: 'segment'
          },
          new AggConfig({
            type: 'terms',
            schema: 'split'
          })
        ]);

        expect(ac).to.have.length(2);
        expect(SpiedAggConfig).to.have.property('callCount', 1);
      });
    });

    describe('#getSorted', function () {
      it('performs a stable sort, but moves metrics to the bottom', function () {
        var vis = new Vis(indexPattern, {
          type: 'histogram',
          aggs: [
            { type: 'avg', schema: 'metric' },
            { type: 'terms', schema: 'split' },
            { type: 'histogram', schema: 'split' },
            { type: 'sum', schema: 'metric' },
            { type: 'date_histogram', schema: 'segment' },
            { type: 'filters', schema: 'split' },
            { type: 'count', schema: 'metric' }
          ]
        });

        var avg = vis.aggs.byTypeName.avg[0];
        var sum = vis.aggs.byTypeName.sum[0];
        var count = vis.aggs.byTypeName.count[0];
        var terms = vis.aggs.byTypeName.terms[0];
        var histo = vis.aggs.byTypeName.histogram[0];
        var dateHisto = vis.aggs.byTypeName.date_histogram[0];
        var filters = vis.aggs.byTypeName.filters[0];

        var sorted = vis.aggs.getSorted();

        expect(sorted.shift()).to.be(terms);
        expect(sorted.shift()).to.be(histo);
        expect(sorted.shift()).to.be(dateHisto);
        expect(sorted.shift()).to.be(filters);
        expect(sorted.shift()).to.be(avg);
        expect(sorted.shift()).to.be(sum);
        expect(sorted.shift()).to.be(count);
        expect(sorted).to.have.length(0);
      });
    });

    describe('#toDsl', function () {
      it('uses the sorted aggs', function () {
        var vis = new Vis(indexPattern, { type: 'histogram' });
        sinon.spy(vis.aggs, 'getSorted');
        vis.aggs.toDsl();
        expect(vis.aggs.getSorted).to.have.property('callCount', 1);
      });

      it('calls aggConfig#toDsl() on each aggConfig and compiles the nested output', function () {
        var vis = new Vis(indexPattern, {
          type: 'histogram',
          aggs: [
            { type: 'date_histogram', schema: 'segment' },
            { type: 'filters', schema: 'split' }
          ]
        });

        var aggInfos = vis.aggs.map(function (aggConfig) {
          var football = {};

          sinon.stub(aggConfig, 'toDsl', function () {
            return football;
          });

          return {
            id: aggConfig.id,
            football: football
          };
        });

        (function recurse(lvl) {
          var info = aggInfos.shift();

          expect(lvl).to.have.property(info.id);
          expect(lvl[info.id]).to.be(info.football);

          if (lvl[info.id].aggs) {
            return recurse(lvl[info.id].aggs);
          }
        }(vis.aggs.toDsl()));

        expect(aggInfos).to.have.length(0);
      });

      it('skips aggs that don\'t have a dsl representation', function () {
        var vis = new Vis(indexPattern, {
          type: 'histogram',
          aggs: [
            { type: 'date_histogram', schema: 'segment', params: { field: '@timestamp' } },
            { type: 'count', schema: 'metric' }
          ]
        });

        var dsl = vis.aggs.toDsl();
        var histo = vis.aggs.byTypeName.date_histogram[0];
        var count = vis.aggs.byTypeName.count[0];

        expect(dsl).to.have.property(histo.id);
        expect(dsl[histo.id]).to.be.an('object');
        expect(dsl[histo.id]).to.not.have.property('aggs');
        expect(dsl).to.not.have.property(count.id);
      });

      it('writes multiple metric aggregations at the same level', function () {
        var vis = new Vis(indexPattern, {
          type: 'histogram',
          aggs: [
            { type: 'date_histogram', schema: 'segment', params: { field: '@timestamp' } },
            { type: 'avg', schema: 'metric', params: { field: 'bytes' }  },
            { type: 'sum', schema: 'metric', params: { field: 'bytes' }  },
            { type: 'min', schema: 'metric', params: { field: 'bytes' }  },
            { type: 'max', schema: 'metric', params: { field: 'bytes' }  }
          ]
        });

        var dsl = vis.aggs.toDsl();

        var histo = vis.aggs.byTypeName.date_histogram[0];
        var metrics = vis.aggs.bySchemaGroup.metrics;

        expect(dsl).to.have.property(histo.id);
        expect(dsl[histo.id]).to.be.an('object');
        expect(dsl[histo.id]).to.have.property('aggs');

        metrics.forEach(function (metric) {
          expect(dsl[histo.id].aggs).to.have.property(metric.id);
          expect(dsl[histo.id].aggs[metric.id]).to.not.have.property('aggs');
        });
      });
    });
  }];
});