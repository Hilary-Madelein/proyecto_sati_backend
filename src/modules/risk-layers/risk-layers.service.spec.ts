import { fetchArcgisLayer, fetchArcgisLayerAttachments, fetchArcgisVersion } from '../../integrations/arcgis/arcgis-feature-layer.js';
import { located, RiskLayersService } from './risk-layers.service.js';

vi.mock('../../integrations/arcgis/arcgis-feature-layer.js', () => ({
  fetchArcgisLayer: vi.fn(),
  fetchArcgisVersion: vi.fn(),
  fetchArcgisAttachments: vi.fn(),
  fetchArcgisLayerAttachments: vi.fn(),
}));

describe('located', () => {
  const point = (coordinates: unknown) => ({ type: 'Feature' as const, geometry: { type: 'Point', coordinates }, properties: {} });

  it('descarta las entidades sin geometría o fuera del Ecuador', () => {
    const result = located([
      point([-79.2, -3.9]),
      point([-90.3, -0.7]), // Galápagos
      point([-78.74668, -89.99998]), // latitud de -90: coordenada mal cargada
      point([9682345, 748036]), // UTM tomada como grados
      { type: 'Feature', geometry: null, properties: {} },
    ]);
    expect(result.features.map((feature) => feature.geometry?.coordinates)).toEqual([[-79.2, -3.9], [-90.3, -0.7]]);
    expect(result.omitted).toBe(3);
  });

  it('mira el primer vértice de líneas y polígonos', () => {
    const line = { type: 'Feature' as const, geometry: { type: 'MultiLineString', coordinates: [[[-80, -2], [-79.9, -2.1]]] }, properties: {} };
    expect(located([line]).omitted).toBe(0);
  });
});

describe('RiskLayersService: actualización de las capas', () => {
  const download = vi.mocked(fetchArcgisLayer);
  const version = vi.mocked(fetchArcgisVersion);
  const camp = (estado: string) => ({ type: 'Feature' as const, geometry: { type: 'Point', coordinates: [-79.2, -3.9] }, properties: { ESTADO: estado } });
  // Una capa sin vía más cercana ni campos calculados: solo se prueba cuándo se descarga.
  const LAYER = 'shelters';

  beforeEach(() => {
    vi.useFakeTimers();
    download.mockReset().mockResolvedValue({ features: [camp('INACTIVO')], lastEditDate: null, version: 1, hasAttachments: false });
    version.mockReset().mockResolvedValue(1);
  });
  afterEach(() => vi.useRealTimers());

  it('no pregunta al servicio más de una vez por minuto', async () => {
    const service = new RiskLayersService();
    await service.get(LAYER);
    vi.advanceTimersByTime(30_000);
    await service.get(LAYER);
    expect(download).toHaveBeenCalledTimes(1);
    expect(version).not.toHaveBeenCalled();
  });

  it('si la capa no cambió, solo pregunta su versión y no la descarga de nuevo', async () => {
    const service = new RiskLayersService();
    await service.get(LAYER);
    vi.advanceTimersByTime(61_000);
    await service.get(LAYER);
    expect(version).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('si la editaron, la descarga de nuevo y entrega el dato actualizado', async () => {
    const service = new RiskLayersService();
    await service.get(LAYER);
    version.mockResolvedValue(2);
    download.mockResolvedValue({ features: [camp('OPERATIVO')], lastEditDate: null, version: 2, hasAttachments: false });
    vi.advanceTimersByTime(61_000);
    const data = await service.get(LAYER);
    expect(download).toHaveBeenCalledTimes(2);
    expect(data.features[0].properties.ESTADO).toBe('OPERATIVO');
  });

  it('si el servicio no informa su versión, la descarga de nuevo cuando vence su plazo', async () => {
    download.mockResolvedValue({ features: [camp('INACTIVO')], lastEditDate: null, version: null, hasAttachments: false });
    const service = new RiskLayersService();
    await service.get(LAYER);
    vi.advanceTimersByTime(61_000);
    await service.get(LAYER);
    expect(download).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(12 * 60 * 60_000);
    await service.get(LAYER);
    expect(download).toHaveBeenCalledTimes(2);
    expect(version).not.toHaveBeenCalled();
  });

  it('si el servicio falla, entrega la última descarga marcada como vieja', async () => {
    const service = new RiskLayersService();
    await service.get(LAYER);
    version.mockRejectedValue(new Error('sin conexión'));
    vi.advanceTimersByTime(61_000);
    const data = await service.get(LAYER);
    expect(data.isStale).toBe(true);
    expect(data.features).toHaveLength(1);
  });
});

describe('RiskLayersService: fotos de toda la capa', () => {
  const download = vi.mocked(fetchArcgisLayer);
  const version = vi.mocked(fetchArcgisVersion);
  const photos = vi.mocked(fetchArcgisLayerAttachments);
  const point = (id: number) => ({ type: 'Feature' as const, id, geometry: { type: 'Point', coordinates: [-79.2, -3.9] }, properties: {} });
  const LAYER = 'shelters';

  beforeEach(() => {
    vi.useFakeTimers();
    download.mockReset().mockResolvedValue({ features: [point(7), point(8)], lastEditDate: null, version: 1, hasAttachments: true });
    version.mockReset().mockResolvedValue(1);
    photos.mockReset().mockResolvedValue(new Map([[7, [{ id: 6, name: 'a.jpg', url: 'https://x/7/attachments/6' }]]]));
  });
  afterEach(() => vi.useRealTimers());

  it('las pide una vez para todas las entidades y las guarda mientras la capa no cambie', async () => {
    const service = new RiskLayersService();
    expect(await service.layerAttachments(LAYER)).toEqual({ 7: [{ id: 6, name: 'a.jpg', url: 'https://x/7/attachments/6' }] });
    expect(photos).toHaveBeenCalledWith(expect.any(String), [7, 8]);
    vi.advanceTimersByTime(61_000);
    await service.layerAttachments(LAYER);
    expect(photos).toHaveBeenCalledTimes(1);
  });

  it('las vuelve a pedir cuando la capa cambia (p. ej. subieron una foto)', async () => {
    const service = new RiskLayersService();
    await service.layerAttachments(LAYER);
    version.mockResolvedValue(2);
    download.mockResolvedValue({ features: [point(7), point(8)], lastEditDate: null, version: 2, hasAttachments: true });
    vi.advanceTimersByTime(61_000);
    await service.layerAttachments(LAYER);
    expect(photos).toHaveBeenCalledTimes(2);
  });

  it('si la capa no tiene adjuntos no consulta el servicio', async () => {
    download.mockResolvedValue({ features: [point(7)], lastEditDate: null, version: 1, hasAttachments: false });
    expect(await new RiskLayersService().layerAttachments(LAYER)).toEqual({});
    expect(photos).not.toHaveBeenCalled();
  });
});
