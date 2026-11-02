import { describe, expect, it } from 'vitest';
import type { ParishPoint } from '../canton-analysis/parishes.js';
import type { FlashFloodArea, FlashFloodLikelihood } from '../flood-hub/flood-hub-source.js';
import { explorerView, isExplorerData, parseTarget, type ExplorerData, type ExplorerTarget } from './flood-alert-explorer.js';
import type { AlertCanton } from './flood-alert-messages.js';

const canton = (code: string, name: string, province: string, likelihood: FlashFloodLikelihood, forecastMm?: number): AlertCanton => ({
  code,
  canton: name,
  province,
  likelihood,
  ...(forecastMm !== undefined && { rain: { forecastMm, measured: null } }),
});

const parish = (code: string, name: string, cantonCode: string, lat: number, lng: number): ParishPoint => ({
  code,
  name,
  cantonCode,
  canton: '',
  province: '',
  kind: 'rural',
  lat,
  lng,
});

/** Zona de Google entre las longitudes -80 y -79 y las latitudes -3 y -2. */
const zone: FlashFloodArea = {
  id: 'z',
  likelihood: 'likely',
  issuedAt: '2026-11-01T19:33:35Z',
  validUntil: '2026-11-02T19:33:35Z',
  countries: ['EC'],
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [-80, -3],
          [-79, -3],
          [-79, -2],
          [-80, -2],
          [-80, -3],
        ],
      ],
    ],
  },
};

const provinces = [
  { name: 'El Oro', cantons: [] },
  { name: 'Guayas', cantons: [] },
  { name: 'Los Ríos', cantons: [] },
];

const data = (cantons: AlertCanton[]): ExplorerData => ({
  cantons,
  validUntil: new Date('2026-11-02T19:33:35Z'),
  zones: [zone],
  parishes: [
    parish('091250', 'Milagro', '0912', -2.1, -79.6),
    parish('091251', 'Chobo', '0912', -2.2, -79.6),
    parish('091252', 'Roberto Astudillo', '0912', -1.5, -79.6),
    parish('091253', 'Sin pronóstico', '0912', -2.3, -79.6),
  ],
  forecasts: [
    { code: '091250', forecast: { mm12h: 1, mm24h: 120, category12h: null, category24h: null } },
    { code: '091251', forecast: { mm12h: 1, mm24h: 0.4, category12h: null, category24h: null } },
    { code: '091252', forecast: { mm12h: 1, mm24h: 41, category12h: null, category24h: null } },
  ],
  provinces,
});

const labels = (view: { buttons: { label: string; data: string }[][] }) => view.buttons.flat().map(({ label }) => label);
const go = (explorer: ExplorerData, data: string) => explorerView(explorer, parseTarget(data, provinces) as ExplorerTarget);
const tap = (explorer: ExplorerData, view: { buttons: { label: string; data: string }[][] }, label: string) =>
  go(explorer, view.buttons.flat().find((button) => button.label === label)!.data);

describe('Más detalle', () => {
  // Zona 8: Guayaquil y Durán. Zona 5: Milagro (Guayas) y Babahoyo (Los Ríos). Zona 7: Machala.
  const national = data([
    canton('0901', 'Guayaquil', 'Guayas', 'highly_likely', 24),
    canton('0907', 'Durán', 'Guayas', 'likely', 20),
    canton('0912', 'Milagro', 'Guayas', 'likely', 120),
    canton('1201', 'Babahoyo', 'Los Ríos', 'likely', 72),
    canton('0701', 'Machala', 'El Oro', 'likely', 6),
  ]);

  it('baja de zona a provincia, a cantón y a parroquias, y vuelve', () => {
    const root = go(national, 'x');
    expect(root.text).toContain('Riesgo vigente por zona');
    expect(labels(root)).toEqual(['🟠 Zona 5 · 2', '🟠 Zona 7 · 1', '🔴 Zona 8 · 2']);

    const zone5 = tap(national, root, '🟠 Zona 5 · 2');
    expect(zone5.text).toContain('<b>Zona 5</b> · 2 cantones');
    expect(labels(zone5)).toEqual(['🟠 Guayas · 1', '🟠 Los Ríos · 1', '← Zonas']);

    // Guayas en la Zona 5 tiene un solo cantón: se salta directo a sus parroquias.
    const milagro = tap(national, zone5, '🟠 Guayas · 1');
    expect(milagro.text).toContain('<b>Milagro</b> · Guayas');
    expect(labels(milagro)).toEqual(['← Zona 5']);
  });

  it('en la Zona 8 solo están Guayaquil, Durán y Samborondón, aunque sean de Guayas', () => {
    const zone8 = go(national, 'xz:8');
    expect(zone8.text).toContain('<b>Guayas</b> · Zona 8 · 2 cantones');
    expect(labels(zone8)).toEqual(['🔴 Guayaquil · 24 mm', '🟠 Durán · 20 mm', '← Zonas']);
    expect(zone8.text).not.toContain('Milagro');
  });

  it('ordena los cantones: primero los Muy probables, aunque no llueva, y luego por lluvia', () => {
    const several = data([
      canton('0912', 'Milagro', 'Guayas', 'likely', 120),
      canton('0910', 'Daule', 'Guayas', 'highly_likely', 0),
      canton('0913', 'Naranjal', 'Guayas', 'likely', 50),
    ]);
    expect(labels(go(several, 'x'))).toEqual(['🔴 Daule · 0 mm', '🟠 Milagro · 120 mm', '🟠 Naranjal · 50 mm']);
  });

  it('muestra las parroquias: dentro de la zona de Google primero, con su lluvia', () => {
    const view = go(data([canton('0912', 'Milagro', 'Guayas', 'likely', 120)]), 'x');
    expect(view.text).toContain('⚠️ Milagro · 120 mm\n⚠️ Chobo · &lt;1 mm\n⚠️ Sin pronóstico · sin dato\n▫️ Roberto Astudillo · 41 mm');
    expect(view.text).toContain('vigente hasta');
    expect(view.buttons).toEqual([]);
  });

  it('sin el pronóstico por parroquia, igual lista sus nombres', () => {
    const view = go({ ...data([canton('0912', 'Milagro', 'Guayas', 'likely')]), forecasts: [] }, 'x');
    // Sin cifras, por nombre.
    expect(view.text).toContain('⚠️ Chobo\n⚠️ Milagro\n⚠️ Sin pronóstico\n▫️ Roberto Astudillo');
    expect(view.text).not.toContain('mm');
  });

  it('sin riesgo vigente lo dice, y un botón viejo no rompe nada', () => {
    expect(go(data([]), 'x').text).toContain('no hay riesgo');
    expect(go(national, 'xc:9999:5').text).toContain('Riesgo vigente por zona');
    expect(parseTarget('xp:99:5', provinces)).toBeNull();
    expect(isExplorerData('xz:5')).toBe(true);
    expect(isExplorerData('pv:1')).toBe(false);
  });
});
