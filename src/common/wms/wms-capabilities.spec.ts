import { parseWmsLayerDimensions } from './wms-capabilities.js';

const capabilities = `<?xml version="1.0" encoding="UTF-8"?>
<WMT_MS_Capabilities version="1.1.1">
  <Capability>
    <Layer>
      <Title>GeoServer</Title>
      <Layer>
        <Name>wrf_precipitation</Name>
        <Title>Precipitación</Title>
        <Extent name="time" default="2026-10-03T01:00:00Z">2026-10-03T01:00:00.000Z,2026-10-01T01:00:00.000Z,2026-10-02T01:00:00.000Z</Extent>
        <Extent name="INITD" default="2026-09-30T01:00:00.000Z">2026-09-29T01:00:00.000Z,2026-09-30T01:00:00.000Z</Extent>
      </Layer>
      <Layer>
        <Name>wrf_wind_speed</Name>
      </Layer>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;

describe('parseWmsLayerDimensions', () => {
  it('lee los pasos de tiempo (ordenados) y las dimensiones extra de una capa anidada', () => {
    const result = parseWmsLayerDimensions(capabilities, 'wrf_precipitation');
    expect(result?.times).toEqual(['2026-10-01T01:00:00.000Z', '2026-10-02T01:00:00.000Z', '2026-10-03T01:00:00.000Z']);
    expect(result?.defaultTime).toBe('2026-10-03T01:00:00Z');
    expect(result?.extra.INITD.default).toBe('2026-09-30T01:00:00.000Z');
  });

  it('devuelve null si la capa no existe o no tiene dimensiones', () => {
    expect(parseWmsLayerDimensions(capabilities, 'no_existe')).toBeNull();
    expect(parseWmsLayerDimensions(capabilities, 'wrf_wind_speed')).toBeNull();
  });
});
