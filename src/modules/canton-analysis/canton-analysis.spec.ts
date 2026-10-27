import type { RasterGrid } from '../../common/raster/raster-grid.js';
import { CantonLocator, bboxOf, distanceKm, ringsOf, segmentsOf, type CantonShape } from './canton-geometry.js';
import { parishRain } from './parishes.js';
import { classifyRain, classifyRain12h, classifyRain24h } from './rain-thresholds.js';
import { classifyRoadProjects, isRoadProject, preparednessIndex, preparednessLevel, provinceCodeOf, sameDescription, sameTrace } from './preparedness.js';

describe('classifyRain12h', () => {
  it('usa los umbrales de 12 h del documento con sus cuatro colores', () => {
    expect([0, 0.05, 4.9].map((mm) => classifyRain12h(mm).semaphore)).toEqual(['green', 'green', 'green']);
    expect([5, 14.9, 15, 29.9].map((mm) => classifyRain12h(mm).semaphore)).toEqual(['yellow', 'yellow', 'yellow', 'yellow']);
    expect([30, 69.9].map((mm) => classifyRain12h(mm).semaphore)).toEqual(['orange', 'orange']);
    expect([70, 140].map((mm) => classifyRain12h(mm).semaphore)).toEqual(['red', 'red']);
    expect([0.05, 3, 10, 20, 50, 100, 200].map((mm) => classifyRain12h(mm).label)).toEqual([
      'Mínima',
      'Ligera',
      'Moderada',
      'Fuerte',
      'Intensa',
      'Torrencial',
      'Extrema',
    ]);
  });
});

describe('classifyRain24h', () => {
  it('usa los umbrales de 24 h del documento', () => {
    expect([9.9, 10, 49.9, 50, 99.9, 100, 250].map((mm) => classifyRain24h(mm).semaphore)).toEqual(['green', 'yellow', 'yellow', 'orange', 'orange', 'red', 'red']);
    expect([5, 10, 25, 50, 100, 250].map((mm) => classifyRain24h(mm).label)).toEqual([
      'Ligera',
      'Moderada',
      'Fuerte',
      'Intensa',
      'Torrencial',
      'Extrema',
    ]);
  });
});

describe('classifyRain: S = máx(S12h, S24h)', () => {
  it('manda la categoría más alta de las dos ventanas', () => {
    // 4 mm en 12 h es verde, pero 45 mm en 24 h es amarillo (fuerte): lluvia larga y moderada.
    expect(classifyRain(4, 45)).toMatchObject({ decidedBy: '24h', band: { semaphore: 'yellow', label: 'Fuerte' } });
    // 32 mm en 12 h ya es intensa aunque las 24 h (40 mm) solo den fuerte: aguacero corto.
    expect(classifyRain(32, 40)).toMatchObject({ decidedBy: '12h', band: { semaphore: 'orange', label: 'Intensa' } });
    // 75 mm en 12 h es torrencial (rojo) aunque las 24 h (90 mm) den intensa.
    expect(classifyRain(75, 90)).toMatchObject({ decidedBy: '12h', band: { semaphore: 'red', label: 'Torrencial' } });
    // Con la misma categoría decide la de 12 h.
    expect(classifyRain(6, 12)?.decidedBy).toBe('12h');
  });

  it('sin ningún dato no clasifica (no es verde)', () => {
    expect(classifyRain(null, null)).toBeNull();
    expect(classifyRain(null, 12)?.band.semaphore).toBe('yellow');
  });
});

describe('preparednessIndex (ISPP-FEN)', () => {
  it('compara tasas, no conteos: alojamientos por km² y el resto por km de Red Vial Estatal', () => {
    const result = preparednessIndex([
      { code: 'C', name: 'Provincia C', counts: { shelters: 10, camps: 1, preventiveActions: 40, roadProjects: 2 }, areaKm2: 1000, rveKm: 0 },
      { code: 'A', name: 'Provincia A', counts: { shelters: 30, camps: 4, preventiveActions: 120, roadProjects: 10 }, areaKm2: 1000, rveKm: 100 },
      { code: 'B', name: 'Provincia B', counts: { shelters: 15, camps: 2, preventiveActions: 80, roadProjects: 6 }, areaKm2: 500, rveKm: 100 },
    ]);
    // B tiene la mitad de alojamientos que A pero en la mitad del área: misma densidad (100).
    // B: 0,2·100 + 0,2·50 + 0,25·66,7 + 0,35·60 = 67,7 · C: sin red vial, solo cuentan sus alojamientos: 0,2·33,3 = 6,7.
    expect(result.map((province) => [province.code, province.index, province.level])).toEqual([
      ['A', 100, 'very-high'],
      ['B', 67.7, 'high'],
      ['C', 6.7, 'very-low'],
    ]);
    expect(result[1].scores).toEqual({ shelters: 100, camps: 50, preventiveActions: 66.7, roadProjects: 60 });
    expect(result[1].rates.shelters).toBeCloseTo(0.03);
  });

  it('un indicador sin registros en ninguna provincia vale 0 (no divide por cero)', () => {
    const [only] = preparednessIndex([
      { code: 'X', name: 'X', counts: { shelters: 5, camps: 0, preventiveActions: 0, roadProjects: 0 }, areaKm2: 100, rveKm: 50 },
    ]);
    expect(only.index).toBe(20);
  });

  it('reconoce la provincia del registro aunque esté escrita distinto', () => {
    const codes = new Map([
      ['EL ORO', '07'],
      ['SANTO DOMINGO DE LOS TSACHILAS', '23'],
      ['SANTA ELENA', '24'],
      ['LOS RIOS', '12'],
    ]);
    expect(['EL  ORO', 'El Oro', 'SANTO DOMINGO', 'LOS RÍOS'].map((name) => provinceCodeOf(name, codes))).toEqual(['07', '07', '23', '12']);
    // Ambiguo o desconocido: no se adivina.
    expect(provinceCodeOf('SAN', codes)).toBeNull(); // Santa Elena o Santo Domingo
    expect(provinceCodeOf('', codes)).toBeNull();
  });

  it('solo cuenta como proyecto vial las obras viales', () => {
    expect(isRoadProject('CARRETERA CHONTADURO - CHUMUNDE', 0)).toBe(true);
    expect(isRoadProject('CONSTRUCCION DEL PUENTE QUIMÍS', 1)).toBe(true);
    expect(isRoadProject('RECONSTRUCCIÓN DE LA INFRAESTRUCTURA AFECTADA EL SECTOR TAMBAN', 1)).toBe(true);
    expect(isRoadProject('MERCADO MUNICIPAL DE CALCETA', 0)).toBe(false);
    expect(isRoadProject('CONSTRUCCIÓN DE UNA PLANTA DE AGUA POTABLE Y MEJORAMIENTO DEL SISTEMA DE IMPULSION', 0)).toBe(false);
    expect(isRoadProject('ASFALTADO VIAL Y OBRAS COMPLEMENTARIAS EN AVENIDA PUERTA DEL SOL II', 1)).toBe(false);
  });

  it('reconoce la misma obra cargada dos veces por su trazado', () => {
    expect(sameTrace([-79.4, -2.35, -79.3, -2.2], [-79.395, -2.352, -79.302, -2.205])).toBe(true);
    expect(sameTrace([-79.4, -2.35, -79.3, -2.2], [-79.4, -2.35, -79.3, -2.1])).toBe(false);
    expect(sameTrace(null, null)).toBe(false);
  });

  it('juzga cada obra por su estado y marca como repetidas las copias de las que cuentan', () => {
    const line = (lng: number, length = 0.2) => ({ type: 'LineString', coordinates: [[lng, -2], [lng + length, -2.1]] });
    const work = (Nro: number, Estado_actual: string, Accion_Esp: string, geometry: object, contract = false, Provincia = 'GUAYAS') => ({
      type: 'Feature' as const,
      geometry: geometry as { type: string; coordinates: unknown },
      properties: { Nro, Provincia, Estado_actual, Accion_Esp, Join_Count: 1, Presupuesto_tot: contract ? 1000 : null },
    });
    const E15 = 'MANTENIMIENTO PREVENTIVO DE LA RED VIAL ESTATAL E-15, DESDE ROCAFUERTE';
    const E482 = 'REHABILITACIÓN Y MANTENIMIENTO DE LA RED VIAL ESTATAL E482, TRAMO MONTECRISTI';
    const categories = classifyRoadProjects([
      work(12, 'En ejecución', 'REHABILITACIÓN DE LA VÍA E-47 EL TRIUNFO', line(-79.4)), // copia del 6 (mismo trazado)
      work(6, 'En ejecución', 'REHABILITACIÓN DE LA VÍA E-47 EL TRIUNFO', line(-79.4), true),
      work(7, 'Finalizado', 'REHABILITACIÓN TRAMO PALESTINA - VINCES', line(-79.9)),
      work(13, 'Por contratar', 'RECAPEO ASFÁLTICO', line(-80.1)),
      work(18, 'En ejecución', 'ASFALTADO EN AVENIDA PUERTA DEL SOL II', line(-80.9)),
      // El 10 está por adjudicar y el 31 (misma descripción, recortada) en ejecución: el 31 cuenta por su propio estado.
      work(31, 'En ejecución', E15, line(-80.5, 0.5)),
      work(10, 'Por adjudicar', `${E15}, CON UNA LONGITUD DE 47,6 KM`, line(-80.45, 0.02), true),
      work(30, 'En ejecución', E482, line(-81.2, 0.6)), // copia del 9: misma descripción recortada
      work(9, 'En ejecución', `${E482}, LOCALIZADO EN MANABÍ`, line(-81.3, 0.3), true),
      work(6, 'En ejecución', 'REHABILITACIÓN DE LA VÍA E-47 EL TRIUNFO', line(-79.4), true, 'CAÑAR'), // otra provincia
    ]);
    expect(categories).toEqual([
      'repeated',
      'counted',
      'counted',
      'not-contracted',
      'not-road',
      'counted',
      'not-contracted',
      'repeated',
      'counted',
      'counted',
    ]);
  });

  it('reconoce la misma descripción recortada, no las que solo empiezan igual', () => {
    expect(sameDescription('MANTENIMIENTO PREVENTIVO DE LA RED VIAL ESTATAL E-15', 'MANTENIMIENTO PREVENTIVO DE LA RED VIAL ESTATAL E-15, CON 47,6 KM')).toBe(true);
    expect(sameDescription('REHABILITACIÓN DE LA VÍA', 'REHABILITACIÓN DE LA VÍA QUEVEDO - EL EMPALME')).toBe(false); // muy corta
  });

  it('usa los intervalos del semáforo del documento', () => {
    expect([0, 20, 20.1, 40, 40.1, 60, 60.1, 80, 80.1, 100].map(preparednessLevel)).toEqual([
      'very-low',
      'very-low',
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
      'very-high',
      'very-high',
    ]);
  });
});

/** Cuadrado de 1° x 1° con esquina en (lng, lat). */
const square = (code: string, lng: number, lat: number): CantonShape => {
  const rings = ringsOf({
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + 1, lat],
        [lng + 1, lat + 1],
        [lng, lat + 1],
        [lng, lat],
      ],
    ],
  });
  return { code, name: code, provinceCode: code.slice(0, 2), province: 'P', region: null, population: null, areaKm2: null, rings, bbox: bboxOf(rings) };
};

describe('CantonLocator', () => {
  it('ubica cada punto en el cantón que lo contiene', () => {
    const locator = new CantonLocator([square('A', -80, -2), square('B', -79, -2)]);
    expect(locator.locate(-79.5, -1.5)?.code).toBe('A');
    expect(locator.locate(-78.5, -1.5)?.code).toBe('B');
    expect(locator.locate(-70, -1.5)).toBeNull();
  });
});

describe('parishRain', () => {
  // Grilla de 10 x 10 celdas de 0,1°; la lluvia crece de oeste a este (0 a 90 mm en 12 h, el doble en 24 h).
  const grid = (factor: number): RasterGrid => ({
    width: 10,
    height: 10,
    bbox: [-80, -2, -79, -1],
    values: Float64Array.from({ length: 100 }, (_, i) => (i % 10) * 10 * factor),
    noData: null,
  });

  it('toma el valor de la celda donde cae el punto, sin promediar', () => {
    // Celda de la columna 7: 70 mm en 12 h (torrencial, rojo) y 140 mm en 24 h.
    const rain = parishRain({ lat: -1.55, lng: -79.25 }, grid(1), grid(2));
    expect(rain.forecast).toEqual({ mm12h: 70, mm24h: 140, category12h: 'torrencial', category24h: 'torrencial' });
    expect(rain).toMatchObject({ semaphore: 'red', category: 'torrencial', decidedBy: '12h' });
  });

  it('manda la ventana más grave', () => {
    // 20 mm en 12 h (fuerte) y 60 mm en 24 h (intensa): decide la de 24 h, en naranja.
    const rain = parishRain({ lat: -1.55, lng: -79.75 }, grid(1), grid(3));
    expect(rain).toMatchObject({ semaphore: 'orange', category: 'intensa', decidedBy: '24h' });
  });

  it('fuera de la grilla no clasifica (no es verde)', () => {
    expect(parishRain({ lat: 0.5, lng: -78 }, grid(1), grid(2))).toMatchObject({ decidedBy: null, forecast: { mm12h: null, mm24h: null } });
  });
});

describe('líneas', () => {
  it('parte las líneas en tramos y mide su largo en km', () => {
    const segments = segmentsOf({ type: 'MultiLineString', coordinates: [[[-79, -2], [-79, -1], [-78, -1]]] });
    expect(segments).toHaveLength(2);
    expect(distanceKm(...segments[0])).toBeCloseTo(111.2, 0);
  });
});
