import type { GeoJsonFeature } from '../../integrations/arcgis/arcgis-feature-layer.js';

/**
 * Nombres de las opciones de las encuestas de acciones preventivas y de respuesta
 * del MIT: las capas guardan el código de cada opción elegida ("limpieza_cunetas,otro_1").
 */
const PREVENTIVE_ACTIONS: Record<string, string> = {
  limpieza_cunetas: 'Limpieza de cunetas',
  limpieza_alcantarillas: 'Limpieza de alcantarillas',
  limpieza_calzada_espaldo: 'Limpieza de calzada y espaldones',
  desazolve_cauces: 'Desazolve de cauces',
  control_vegetacion: 'Control de vegetación',
};
const MACHINERY: Record<string, string> = {
  excavadora: 'Excavadora',
  retroexcavadora: 'Retroexcavadora',
  volqueta: 'Volqueta',
  cargadora: 'Cargadora',
  minicargadora: 'Minicargadora',
  motoniveladora: 'Motoniveladora',
  tractor_oruga: 'Tractor de oruga',
  cama_baja: 'Cama baja',
  camioneta: 'Camioneta',
  rodillo_liso: 'Rodillo liso',
};
const RESPONSE_ACTIONS: Record<string, string> = {
  despeje_derrumbe: 'Despeje de derrumbe',
  apertura_variante: 'Apertura de variante',
  reconformacion_calzada: 'Reconformación de calzada',
  terrazas_talud: 'Terrazas en talud',
  muro_pantalla_emerg: 'Muro pantalla de emergencia',
};
const EVENTS: Record<string, string> = {
  deslizamiento: 'Deslizamiento',
  desbordamiento_rio: 'Desbordamiento de río',
  caida_arboles: 'Caída de árboles',
  talud_inestable: 'Talud inestable',
};
const ORIGINS: Record<string, string> = { mit: 'MIT' };
const INSTITUTIONS: Record<string, string> = {
  mit_mtop: 'MIT',
  gad_provincial: 'GAD provincial',
  gad_cantonal: 'GAD cantonal',
  gobernacion: 'Gobernación',
  sngr: 'SNGR',
  policia_nacional: 'Policía Nacional',
};

/** "limpieza_cunetas,otro_1" → "Limpieza de cunetas, <lo escrito en «otro»>"; una opción sin nombre conocido, legible. */
function choices(value: unknown, names: Record<string, string>, other: unknown): string | null {
  const labels = String(value ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
    .flatMap((code) => {
      if (/^otr[oa]/.test(code)) return other ? [String(other).trim()] : [];
      const label = names[code] ?? code.replace(/_/g, ' ');
      return [label.charAt(0).toUpperCase() + label.slice(1)];
    });
  return labels.length > 0 ? labels.join(', ') : null;
}

/** Si una acción de la capa es preventiva (no de respuesta): con o sin el dominio traducido. */
export function isPreventiveAction(type: unknown): boolean {
  return ['PREV', 'PREVENTIVA'].includes(String(type ?? '').trim().toUpperCase());
}

/** Agrega a cada acción `Acciones`, `Maquinaria` e `Instituciones` con sus nombres, en vez de los códigos de la encuesta. */
export function annotatePreventiveActions(features: GeoJsonFeature[]): GeoJsonFeature[] {
  return features.map((feature) => {
    const p = feature.properties;
    return {
      ...feature,
      properties: {
        ...p,
        Acciones: choices(p.actividad_prev, PREVENTIVE_ACTIONS, p.otra_act_prev),
        Maquinaria: choices(p.maq_preventi, MACHINERY, p.otra_maq_prev),
        Instituciones: choices(p.insti_preventi, INSTITUTIONS, p.otra_insti_prev),
      },
    };
  });
}

/**
 * Agrega a cada acción de respuesta `Evento`, `Acciones`, `Origen_maquinaria`,
 * `Maquinaria_MIT` y `Maquinaria_otras` con sus nombres, en vez de los códigos de la encuesta.
 */
export function annotateResponseActions(features: GeoJsonFeature[]): GeoJsonFeature[] {
  return features.map((feature) => {
    const p = feature.properties;
    return {
      ...feature,
      properties: {
        ...p,
        Evento: choices(p.evento, EVENTS, p.otro_tip_event),
        Acciones: choices(p.actividad_respt, RESPONSE_ACTIONS, p.otra_act_respt),
        Origen_maquinaria: choices(p.origen_maq_respt, ORIGINS, p.otra_entidad),
        Maquinaria_MIT: choices(p.maq_respt_mit, MACHINERY, p.otra_maq_respt_mit),
        Maquinaria_otras: choices(p.maq_respt_otra_entidad, MACHINERY, p.otra_maq_respt_otra_entid),
      },
    };
  });
}
