import { buildWmsUrl, WmsRequestError } from './wms-request.js';

const target = {
  serviceUrl: 'http://services.example.org:8080/geoserver/wrf/wms',
  layerName: 'wrf:wrf_precipitation',
  extraParams: ['DIM_INITD'],
};

describe('buildWmsUrl', () => {
  it('fija el servidor y la capa, y pasa solo parámetros permitidos', () => {
    const url = buildWmsUrl(target, {
      request: 'GetMap',
      bbox: '-80,-3,-78,-1',
      width: '256',
      height: '256',
      time: '2026-10-02T01:00:00Z',
      dim_initd: '2026-09-30T01:00:00Z',
      layers: 'otra:capa',
      url: 'http://sitio-malicioso.com',
    });

    expect(url.origin + url.pathname).toBe(target.serviceUrl);
    expect(url.searchParams.get('LAYERS')).toBe('wrf:wrf_precipitation');
    expect(url.searchParams.get('DIM_INITD')).toBe('2026-09-30T01:00:00Z');
    expect(url.searchParams.has('URL')).toBe(false);
    expect(url.searchParams.get('SERVICE')).toBe('WMS');
  });

  it('agrega QUERY_LAYERS en GetFeatureInfo', () => {
    const url = buildWmsUrl(target, { REQUEST: 'GetFeatureInfo', X: '50', Y: '50' });
    expect(url.searchParams.get('QUERY_LAYERS')).toBe('wrf:wrf_precipitation');
  });

  it.each([
    ['sin REQUEST', {}],
    ['REQUEST no permitido', { REQUEST: 'GetCapabilities' }],
    ['imagen demasiado grande', { REQUEST: 'GetMap', WIDTH: '10000' }],
  ])('rechaza peticiones %s', (_case, query) => {
    expect(() => buildWmsUrl(target, query)).toThrow(WmsRequestError);
  });
});
