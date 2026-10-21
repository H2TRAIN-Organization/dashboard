// Funciones de descifrado legacy para el frontend.
// El descifrado real vive en el backend; estas funciones conservan el contrato
// histórico de devolver texto plano cuando no hay material cifrado utilizable.

type LegacyRecord = Record<string, unknown>

function asRecord(value: unknown): LegacyRecord {
  return typeof value === 'object' && value !== null ? (value as LegacyRecord) : {}
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
  }
  return []
}

// Función para descifrar o devolver texto plano
export function decryptOrPlain(text: unknown, iv: unknown): string {
  if (!text) return ''
  if (typeof text !== 'string') return String(text)

  if (text.startsWith('__PLAIN__')) {
    return text.replace('__PLAIN__', '')
  }

  if (!iv) return text

  // El frontend no dispone de la clave del servidor; conserva el valor recibido.
  return text
}

// Función para descifrar arrays de datos
export function decryptArray(data: unknown[] | null, iv: unknown): string[] {
  if (!data || !Array.isArray(data)) return []
  return data.map((item) => decryptOrPlain(item, iv))
}

// Función para descifrar datos de insulina
export function decryptInsulinData<T extends object>(
  data: T[],
): Array<T & { insulinType: string; dose: string }> {
  return data.map((item) => {
    const record = asRecord(item)
    return {
      ...item,
      insulinType: decryptOrPlain(record.insulinType, record.insulintype_iv),
      dose: decryptOrPlain(record.dose, record.dose_iv),
    }
  })
}

// Función para descifrar datos de comida
export function decryptFoodData<T extends object>(
  data: T[],
): Array<T & { food_type: string; quantity: string; carbs: string }> {
  return data.map((item) => {
    const record = asRecord(item)
    return {
      ...item,
      food_type: decryptOrPlain(record.food_type, record.food_type_iv),
      quantity: decryptOrPlain(record.quantity, record.quantity_iv),
      carbs: decryptOrPlain(record.carbs, record.carbs_iv),
    }
  })
}

// Función para descifrar datos de ejercicio
export function decryptExerciseData<T extends object>(
  data: T[],
): Array<T & { exercise_type: string; exercise_description: string }> {
  return data.map((item) => {
    const record = asRecord(item)
    return {
      ...item,
      exercise_type: decryptOrPlain(record.exercise_type, record.exercise_type_iv),
      exercise_description: decryptOrPlain(
        record.exercise_description,
        record.exercise_description_iv,
      ),
    }
  })
}

// Función para descifrar datos de períodos
export function decryptPeriodData<T extends object>(
  data: T[],
): Array<T & { intensity: string; notes: string; symptoms: string[] }> {
  return data.map((item) => {
    const record = asRecord(item)
    const symptoms = toArray(record.symptoms)
    const symptomsIv = toArray(record.symptoms_iv)

    return {
      ...item,
      intensity: decryptOrPlain(record.intensity, record.intensity_iv),
      notes: decryptOrPlain(record.notes, record.notes_iv),
      symptoms: symptoms.map((symptom, index) =>
        symptom ? decryptOrPlain(symptom, symptomsIv[index]) : '',
      ),
    }
  })
}

// Función para descifrar datos de estado de ánimo
export function decryptMoodData<T extends object>(
  data: T[],
): Array<T & { routine_description: string; other_emotion: string; emotions: string[] }> {
  return data.map((item) => {
    const record = asRecord(item)
    const emotions = toArray(record.emotions)
    const emotionsIv = toArray(record.emotions_iv)

    return {
      ...item,
      routine_description: decryptOrPlain(
        record.routine_description,
        record.routine_description_iv,
      ),
      other_emotion: decryptOrPlain(record.other_emotion, record.other_emotion_iv),
      emotions: emotions.map((emotion, index) =>
        emotion ? decryptOrPlain(emotion, emotionsIv[index]) : '',
      ),
    }
  })
}
