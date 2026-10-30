import { annotatePreventiveActions, annotateResponseActions, isPreventiveAction } from './mit-actions.js';

describe('acciones preventivas del MIT', () => {
  const action = (properties: Record<string, unknown>) => ({ type: 'Feature' as const, geometry: null, properties });

  it('cambia los códigos de la encuesta por sus nombres, con lo escrito en "otro"', () => {
    const [p] = annotatePreventiveActions([
      action({
        actividad_prev: 'limpieza_cunetas,otro_1',
        otra_act_prev: 'Limpieza de canales',
        maq_preventi: 'excavadora,volqueta',
        insti_preventi: 'gad_provincial,mit_mtop',
      }),
    ]);
    expect(p.properties).toMatchObject({
      Acciones: 'Limpieza de cunetas, Limpieza de canales',
      Maquinaria: 'Excavadora, Volqueta',
      Instituciones: 'GAD provincial, MIT',
    });
  });

  it('una opción nueva sin nombre conocido sale legible, y sin elegir nada queda vacía', () => {
    const [p] = annotatePreventiveActions([action({ actividad_prev: 'limpieza_de_puentes', maq_preventi: null, insti_preventi: '' })]);
    expect(p.properties).toMatchObject({ Acciones: 'Limpieza de puentes', Maquinaria: null, Instituciones: null });
  });

  it('distingue las preventivas de las de respuesta, con o sin el dominio traducido', () => {
    expect(['prev', 'Preventiva', 'respuesta', 'Respuesta', null].map(isPreventiveAction)).toEqual([true, true, false, false, false]);
  });

  it('traduce también las acciones de respuesta: evento, acción y maquinaria', () => {
    const [p] = annotateResponseActions([
      action({
        evento: 'deslizamiento',
        actividad_respt: 'despeje_derrumbe,otro_4',
        otra_act_respt: 'Reconformación de talud',
        origen_maq_respt: 'mit',
        maq_respt_mit: 'volqueta,rodillo_liso',
      }),
    ]);
    expect(p.properties).toMatchObject({
      Evento: 'Deslizamiento',
      Acciones: 'Despeje de derrumbe, Reconformación de talud',
      Origen_maquinaria: 'MIT',
      Maquinaria_MIT: 'Volqueta, Rodillo liso',
      Maquinaria_otras: null,
    });
  });
});
