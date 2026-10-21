/**
 * Synthetic visual fixtures. No real patient, production or Supabase data.
 * Dates are fixed around the frozen browser clock (2026-10-20 12:00 Europe/Madrid).
 */

const users = [
  {
    UserID: 9001,
    Username: 'demo_admin',
    PasswordHash: 'synthetic-no-login',
    UUID: '00000000-0000-4000-8000-000000009001',
    GDPRConsent: true,
    GDPRConsentDate: '2026-01-10T09:00:00.000Z',
    sexo: 'no_especificado',
    bomba_insulina: false,
    role: 'admin',
  },
  {
    UserID: 9002,
    Username: 'demo_ana',
    PasswordHash: 'synthetic-no-login',
    UUID: '00000000-0000-4000-8000-000000009002',
    GDPRConsent: true,
    GDPRConsentDate: '2026-02-11T09:00:00.000Z',
    sexo: 'femenino',
    bomba_insulina: true,
    role: 'doctor',
  },
  {
    UserID: 9003,
    Username: 'demo_bruno',
    PasswordHash: 'synthetic-no-login',
    UUID: '00000000-0000-4000-8000-000000009003',
    GDPRConsent: false,
    GDPRConsentDate: null,
    sexo: 'masculino',
    bomba_insulina: false,
    role: 'user',
  },
  {
    UserID: 9004,
    Username: 'demo_carla',
    PasswordHash: 'synthetic-no-login',
    UUID: '00000000-0000-4000-8000-000000009004',
    GDPRConsent: true,
    GDPRConsentDate: '2026-03-01T09:00:00.000Z',
    sexo: 'femenino',
    bomba_insulina: false,
    role: 'user',
  },
  {
    UserID: 9005,
    Username: 'demo_diego',
    PasswordHash: 'synthetic-no-login',
    UUID: null,
    GDPRConsent: true,
    GDPRConsentDate: '2026-04-02T09:00:00.000Z',
    sexo: 'masculino',
    bomba_insulina: true,
    role: 'user',
  },
];

const insulinData = [
  ['syn-ins-001', 'demo_ana', 'Bolus', '4', '2026-10-20T07:15:00.000Z'],
  ['syn-ins-002', 'demo_ana', 'Basal', '12', '2026-10-20T07:30:00.000Z'],
  ['syn-ins-003', 'demo_bruno', 'Bolus', '6', '2026-10-19T13:10:00.000Z'],
  ['syn-ins-004', 'demo_ana', 'Bolus', '5', '2026-10-19T19:05:00.000Z'],
  ['syn-ins-005', 'demo_carla', 'Basal', '10', '2026-10-18T08:00:00.000Z'],
  ['syn-ins-006', 'demo_diego', 'Bolus', '3', '2026-10-18T12:40:00.000Z'],
  ['syn-ins-007', 'demo_ana', 'Bolus', '7', '2026-10-17T20:15:00.000Z'],
  ['syn-ins-008', 'demo_bruno', 'Basal', '14', '2026-10-16T07:45:00.000Z'],
  ['syn-ins-009', 'demo_carla', 'Bolus', '4', '2026-10-15T13:20:00.000Z'],
  ['syn-ins-010', 'demo_diego', 'Bolus', '6', '2026-10-14T18:50:00.000Z'],
  ['syn-ins-011', 'demo_ana', 'Basal', '11', '2026-10-14T07:20:00.000Z'],
  ['syn-ins-012', 'demo_bruno', 'Bolus', '5', '2026-10-20T09:05:00.000Z'],
].map(([id, username, insulinType, dose, date_time]) => ({
  id,
  username,
  insulinType,
  dose,
  date_time,
  actualDateTime: date_time,
  insulintype_iv: null,
  dose_iv: null,
}));

const foodData = [
  ['syn-food-001', 'demo_ana', 'Desayuno', '1 ración', '45', '2026-10-20T07:05:00.000Z'],
  ['syn-food-002', 'demo_ana', 'Comida', '1 plato', '60', '2026-10-19T13:00:00.000Z'],
  ['syn-food-003', 'demo_bruno', 'Merienda', '2 piezas', '30', '2026-10-19T17:30:00.000Z'],
  ['syn-food-004', 'demo_carla', 'Cena', '1 plato', '55', '2026-10-18T20:10:00.000Z'],
  ['syn-food-005', 'demo_diego', 'Desayuno', '1 taza', '25', '2026-10-18T07:50:00.000Z'],
  ['syn-food-006', 'demo_ana', 'Cena', '1 plato', '50', '2026-10-17T20:00:00.000Z'],
  ['syn-food-007', 'demo_bruno', 'Comida', '1 plato', '65', '2026-10-16T13:15:00.000Z'],
  ['syn-food-008', 'demo_carla', 'Desayuno', '1 ración', '40', '2026-10-15T07:40:00.000Z'],
  ['syn-food-009', 'demo_diego', 'Comida', '1 plato', '58', '2026-10-14T13:30:00.000Z'],
  ['syn-food-010', 'demo_ana', 'Merienda', '1 pieza', '20', '2026-10-20T10:20:00.000Z'],
].map(([id, username, food_type, quantity, carbs, date_time]) => ({
  id,
  username,
  food_type,
  quantity,
  carbs,
  date_time,
  food_type_iv: null,
  quantity_iv: null,
  carbs_iv: null,
}));

const exerciseData = [
  ['syn-ex-001', 'demo_ana', 'Caminata', 'Moderada', '2026-10-20T08:30:00.000Z', '2026-10-20T09:00:00.000Z', 'Paseo sintético'],
  ['syn-ex-002', 'demo_bruno', 'Ciclismo', 'Alta', '2026-10-19T17:00:00.000Z', '2026-10-19T17:45:00.000Z', 'Ruta sintética'],
  ['syn-ex-003', 'demo_carla', 'Yoga', 'Baja', '2026-10-18T18:00:00.000Z', '2026-10-18T18:30:00.000Z', 'Sesión sintética'],
  ['syn-ex-004', 'demo_diego', 'Carrera', 'Alta', '2026-10-17T07:00:00.000Z', '2026-10-17T07:35:00.000Z', 'Rodaje sintético'],
  ['syn-ex-005', 'demo_ana', 'Natación', 'Moderada', '2026-10-15T19:00:00.000Z', '2026-10-15T19:40:00.000Z', 'Piscina sintética'],
  ['syn-ex-006', 'demo_bruno', 'Fuerza', 'Moderada', '2026-10-14T18:00:00.000Z', '2026-10-14T18:30:00.000Z', 'Rutina sintética'],
].map(([id, username, exercise_type, intensity, exercise_start_time, exercise_end_time, exercise_description]) => ({
  id,
  username,
  exercise_type,
  intensity,
  exercise_start_time,
  exercise_end_time,
  exercise_description,
  date_time: exercise_start_time,
  exercise_type_iv: null,
  exercise_description_iv: null,
}));

const periodData = [
  {
    id: 'syn-period-001',
    username: 'demo_ana',
    startDate: '2026-10-12T00:00:00.000Z',
    endDate: '2026-10-17T00:00:00.000Z',
    intensity: 'Media',
    symptoms: ['dolor_leve'],
    notes: 'Registro sintético',
    date_time: '2026-10-12T00:00:00.000Z',
    intensity_iv: null,
    symptoms_iv: [],
    notes_iv: null,
  },
  {
    id: 'syn-period-002',
    username: 'demo_carla',
    startDate: '2026-09-20T00:00:00.000Z',
    endDate: '2026-09-25T00:00:00.000Z',
    intensity: 'Baja',
    symptoms: [],
    notes: 'Registro sintético',
    date_time: '2026-09-20T00:00:00.000Z',
    intensity_iv: null,
    symptoms_iv: [],
    notes_iv: null,
  },
  {
    id: 'syn-period-003',
    username: 'demo_ana',
    startDate: '2026-09-11T00:00:00.000Z',
    endDate: '2026-09-16T00:00:00.000Z',
    intensity: 'Alta',
    symptoms: ['fatiga'],
    notes: 'Registro sintético',
    date_time: '2026-09-11T00:00:00.000Z',
    intensity_iv: null,
    symptoms_iv: [],
    notes_iv: null,
  },
];

const moodData = [
  ['syn-mood-001', 'demo_ana', 8, '2026-10-20T21:00:00.000Z', ['calma']],
  ['syn-mood-002', 'demo_bruno', 6, '2026-10-19T21:10:00.000Z', ['cansancio']],
  ['syn-mood-003', 'demo_carla', 7, '2026-10-18T21:20:00.000Z', ['alegria']],
  ['syn-mood-004', 'demo_diego', 5, '2026-10-17T21:30:00.000Z', ['estres']],
  ['syn-mood-005', 'demo_ana', 9, '2026-10-16T21:40:00.000Z', ['calma', 'alegria']],
  ['syn-mood-006', 'demo_bruno', 4, '2026-10-15T21:50:00.000Z', ['cansancio']],
  ['syn-mood-007', 'demo_carla', 8, '2026-10-14T22:00:00.000Z', ['calma']],
  ['syn-mood-008', 'demo_diego', 7, '2026-10-13T22:10:00.000Z', ['alegria']],
].map(([id, username, mood_value, date_time, emotions]) => ({
  id,
  username,
  mood_value,
  out_of_routine: false,
  routine_description: 'Rutina sintética',
  emotions,
  other_emotion: '',
  date_time,
  routine_description_iv: null,
  emotions_iv: [],
  other_emotion_iv: null,
}));

export const syntheticUsers = users;

export const decryptedData = {
  insulinData,
  foodData,
  exerciseData,
  periodData,
  moodData,
};

export const usersCount = { count: users.length };

/** Canonical public DTO used by the integrated Next 16 backend contract. */
export const syntheticSessionUser = {
  id: '9001',
  username: 'demo_admin',
  email: 'qa.visual@example.invalid',
  role: 'admin' as const,
  uuid: '00000000-0000-4000-8000-000000009001',
  gdprConsent: true,
  gdprConsentAt: '2026-01-10T09:00:00.000Z',
  createdAt: '2026-01-10T09:00:00.000Z',
};

export const syntheticCanonicalUsers = [
  syntheticSessionUser,
  {
    id: '9002',
    username: 'demo_ana',
    email: 'demo.ana@example.invalid',
    role: 'doctor' as const,
    uuid: '00000000-0000-4000-8000-000000009002',
    gdprConsent: true,
    gdprConsentAt: '2026-02-11T09:00:00.000Z',
    createdAt: '2026-02-11T09:00:00.000Z',
  },
  {
    id: '9003',
    username: 'demo_bruno',
    email: 'demo.bruno@example.invalid',
    role: 'user' as const,
    uuid: '00000000-0000-4000-8000-000000009003',
    gdprConsent: false,
    gdprConsentAt: null,
    createdAt: '2026-02-20T09:00:00.000Z',
  },
  {
    id: '9004',
    username: 'demo_carla',
    email: 'demo.carla@example.invalid',
    role: 'user' as const,
    uuid: '00000000-0000-4000-8000-000000009004',
    gdprConsent: true,
    gdprConsentAt: '2026-03-01T09:00:00.000Z',
    createdAt: '2026-03-01T09:00:00.000Z',
  },
  {
    id: '9005',
    username: 'demo_diego',
    email: 'demo.diego@example.invalid',
    role: 'user' as const,
    uuid: null,
    gdprConsent: true,
    gdprConsentAt: '2026-04-02T09:00:00.000Z',
    createdAt: '2026-04-02T09:00:00.000Z',
  },
];

export const syntheticClientSession = {
  user: syntheticSessionUser,
  method: 'email' as const,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

export const unauthorizedProblem = {
  error: {
    code: 'UNAUTHORIZED',
    message: 'No hay una sesi\u00f3n activa',
  },
};

/** Kubios is explicitly out of scope. Home receives an empty fixture, never the service. */
export const kubiosTeamUsers = { users: [], count: 0 };
export const kubiosHrvResults = { results: [], data: [], count: 0 };

export const databaseTables = {
  success: true,
  tables: [
    { name: 'users', recordCount: 5, accessible: true },
    { name: 'insulindata', recordCount: 12, accessible: true },
    { name: 'fooddata', recordCount: 10, accessible: true },
    { name: 'exercisedata', recordCount: 6, accessible: true },
    { name: 'mooddata', recordCount: 8, accessible: true },
    { name: 'periodrecords', recordCount: 3, accessible: true },
  ],
  totalRecords: 44,
  accessibleCount: 6,
  totalCount: 6,
};
