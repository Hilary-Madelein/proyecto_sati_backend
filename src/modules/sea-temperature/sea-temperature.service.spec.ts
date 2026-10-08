import { BadGatewayException } from '@nestjs/common';
import { UpstreamError } from '../../common/http/upstream.error.js';
import { parseOisstCsv } from '../../integrations/noaa-oisst/noaa-oisst.source.js';
import { meanInBox, SeaTemperatureService } from './sea-temperature.service.js';
import { SeaTemperatureSource, type SeaTemperatureField } from './sea-temperature-source.js';

/** Formato real de ERDDAP: dos líneas de encabezado, latitudes de sur a norte, NaN en tierra. */
const CSV = `time,zlev,latitude,longitude,sst,anom
UTC,m,degrees_north,degrees_east,degree_C,degree_C
2026-10-05T12:00:00Z,0.0,-1.875,-80.875,26.0,2.0
2026-10-05T12:00:00Z,0.0,-1.875,-80.625,NaN,NaN
2026-10-05T12:00:00Z,0.0,-1.625,-80.875,28.0,4.0
2026-10-05T12:00:00Z,0.0,-1.625,-80.625,27.0,3.0
`;

describe('parseOisstCsv', () => {
  const field = parseOisstCsv(CSV);

  it('arma grillas con la fila 0 al norte y el borde media celda más allá de los centros', () => {
    expect(field.time).toBe('2026-10-05T12:00:00.000Z');
    expect([field.anomaly.width, field.anomaly.height]).toEqual([2, 2]);
    expect(field.anomaly.bbox).toEqual([-81, -2, -80.5, -1.5]);
    // Fila 0 = latitud -1.625 (la más al norte).
    expect(Array.from(field.anomaly.values.slice(0, 2))).toEqual([4, 3]);
    expect(field.sst.values[2]).toBe(26);
  });

  it('deja las celdas de tierra (NaN) sin dato', () => {
    expect(Number.isNaN(field.anomaly.values[3])).toBe(true);
  });

  it('rechaza una respuesta sin las columnas esperadas', () => {
    expect(() => parseOisstCsv('<html>error</html>')).toThrow(UpstreamError);
  });
});

describe('meanInBox', () => {
  it('promedia solo las celdas con dato dentro del recuadro', () => {
    const { anomaly } = parseOisstCsv(CSV);
    expect(meanInBox(anomaly, [-90, -10, -80, 0])).toBe(3);
    expect(meanInBox(anomaly, [-81, -2, -80.8, -1.5])).toBe(3);
    expect(meanInBox(anomaly, [-70, -10, -60, 0])).toBeNull();
  });
});

describe('SeaTemperatureService', () => {
  class FakeSource extends SeaTemperatureSource {
    readonly attribution = 'prueba';
    calls = 0;
    constructor(private readonly field: () => SeaTemperatureField) {
      super();
    }
    async getLatest() {
      this.calls++;
      return this.field();
    }
  }

  it('informa la anomalía de Niño 1+2 y el valor de un punto de mar', async () => {
    const source = new FakeSource(() => ({ ...parseOisstCsv(CSV), time: new Date().toISOString() }));
    const service = new SeaTemperatureService(source);

    const meta = await service.current();
    expect(meta).toMatchObject({ nino12Anomaly: 3, minAnomaly: 2, maxAnomaly: 4, isStale: false });
    expect(meta.legend.entries.length).toBeGreaterThan(2);

    // Mar abierto frente a Puerto López; la segunda está en tierra firme (costa real, no la grilla).
    expect(await service.valueAt(-1.7, -80.95)).toMatchObject({ sst: 28, anomaly: 4 });
    expect(await service.valueAt(-1.8, -80.55)).toMatchObject({ sst: null, anomaly: null });
    expect(source.calls).toBe(1);
  });

  it('marca el dato como atrasado si tiene más de 4 días', async () => {
    const old = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const service = new SeaTemperatureService(new FakeSource(() => ({ ...parseOisstCsv(CSV), time: old })));
    expect((await service.current()).isStale).toBe(true);
  });

  it('traduce un fallo de la fuente en 502', async () => {
    const service = new SeaTemperatureService(
      new FakeSource(() => {
        throw new UpstreamError('NOAA OISST', 'sin respuesta');
      }),
    );
    await expect(service.current()).rejects.toBeInstanceOf(BadGatewayException);
  });
});
