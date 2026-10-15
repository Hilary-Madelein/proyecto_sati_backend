import { floodTypeFromSngrEvent, hasDamageFromSngrEvent } from './sngr-flood.classifier.js';
import { sngrEventSchema } from './sngr.schema.js';

const classify = (Evento: string, DescripcionGeneralDeEvento: string, Causa = 'Lluvias intensas') =>
  floodTypeFromSngrEvent({ Evento, Causa, DescripcionGeneralDeEvento });

describe('floodTypeFromSngrEvent', () => {
  // Relatos reales de la SNGR (septiembre-octubre de 2026), recortados.
  it.each([
    [
      'Inundación',
      'se reportó el desbordamiento del río Chilintomo, en donde se reportan 5 metros lineales afectados',
      'river_flood',
    ],
    ['Inundación', 'se produjo el incremento del nivel del estero Guachapelí, ocasionando inundaciones', 'river_flood'],
    [
      'Inundación',
      'se produjo el desbordamiento de un cuerpo hídrico, generando inundaciones en varias comunidades',
      'river_flood',
    ],
    [
      'Aluvión (Flujos)',
      'se reportó el desbordamiento de una quebrada S/N, que provocó el arrastre de tierra',
      'river_flood',
    ],
    ['Inundación', 'se produjo acumulación de aguas lluvias, afectando 129 ha de arroz', 'rain_flood'],
    ['Inundación', 'se reportan varios sectores con acumulación de agua en las calles y avenidas', 'rain_flood'],
    [
      'Inundación',
      'se produjo la anegación de agua en el sector, por el taponamiento del alcantarillado',
      'drainage_flood',
    ],
    [
      'Lluvias Intensas',
      'se suscitó el taponamiento de la alcantarilla, con ingreso de agua a viviendas',
      'drainage_flood',
    ],
    ['Inundación', 'el fuerte oleaje provocó el ingreso de agua a las viviendas', 'coastal_flood'],
    [
      'Inundación',
      'hubo una inundación que afectó varias comunidades. El río presenta tendencia a aumentar de nivel',
      'river_flood',
    ],
    ['Inundación', 'se registró el aumento y desbordamiento del caudal del canal El Burro', 'drainage_flood'],
    ['Inundación', 'se produjo la acumulación de aguas lluvias en los canales de riego', 'drainage_flood'],
    [
      'Inundación',
      'se produjo el taponamiento de la alcantarilla donde pasa un estero S/N, ocasionando el incremento del nivel del agua',
      'drainage_flood',
    ],
    ['Lluvias Intensas', 'la escorrentía afectó a cuatro viviendas', 'rain_flood'],
  ])('%s: "%s" -> %s', (evento, description, expected) => {
    expect(classify(evento, description)).toBe(expected);
  });

  it('usa la causa "Desbordamiento de cuerpos de agua" aunque el relato no lo diga', () => {
    expect(classify('Inundación', 'inundación en el sector', 'Desbordamiento de cuerpos de agua')).toBe('river_flood');
  });

  it('usa el subtipo del catálogo si la SNGR lo envía', () => {
    expect(classify('Inundación fluvial', 'calles anegadas')).toBe('river_flood');
    expect(classify('Inundación pluvial', 'desbordamiento del río')).toBe('rain_flood');
    expect(classify('Inundación costera', '')).toBe('coastal_flood');
  });

  it('una erosión de la orilla por la crecida del río no es inundación', () => {
    expect(
      classify('Erosión Hídrica', 'se produjo un aumento de caudal del río Taura, ocasionando una erosión hídrica'),
    ).toBeNull();
  });

  it.each([
    ['Lluvias Intensas', 'se produjo el colapso de la pared de dos viviendas'],
    ['Lluvias Intensas', 'se registró la caída de un árbol sobre una vivienda'],
    ['Deslizamiento', 'desbordamiento del río y deslizamiento de tierra'],
    ['Vendaval', 'ingreso de agua por la lluvia'],
    ['Granizada', ''],
  ])('%s: "%s" no es inundación', (evento, description) => {
    expect(classify(evento, description)).toBeNull();
  });
});

describe('hasDamageFromSngrEvent', () => {
  const REQUIRED = {
    FechaDelEvento: '1/10/2026',
    NivelDelEvento: 'Nivel 1',
    Latitud: -1.8,
    Longitud: -79.53,
  };
  const figures = (values: object) => sngrEventSchema.parse({ ...REQUIRED, ...values });

  it.each([
    [{ PersonasDamnificadas: '4' }, true],
    [{ ViviendasAfectadas: '3' }, true],
    [{ FamiliasAfectadas: '79' }, true],
    [{ HaCultivoPerdidos: '0.50' }, true],
    [{ EstablecimientosEducativosAfectados: '1' }, true],
    [{ MetrosLinealesDeViasAfectadas: '200' }, false],
    [{}, false],
  ])('%o -> %s', (values, expected) => {
    expect(hasDamageFromSngrEvent(figures(values))).toBe(expected);
  });
});
