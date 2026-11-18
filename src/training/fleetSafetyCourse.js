// Fleet safety course ("Seguridad de Flota").
//
// Migrated from the Microsoft Forms quiz. The answer key lives ONLY here on the
// server — the public `trainingCourse` query strips `correct` before returning.
//
// Choice order is intentional and must not be shuffled: question q16 has an
// option that refers to other options by letter ("c y d").
//
// Bump `version` whenever questions or answers change; it is stored on every
// attempt so historical scores stay interpretable.

const course = {
  version: '2026-11-v1',
  title: 'Seguridad de Flota',
  passingPercentage: 80,
  areas: ['PRPHT', 'PRVCU', 'Colmena 66', 'Administración', 'P18', 'Fase 1', 'Otro'],
  videos: [
    { id: 'video-1', title: 'Video 1 — Seguridad de flota', youtubeId: 'nwyhSzOUfgc' },
    { id: 'video-2', title: 'Video 2 — Seguridad de flota', youtubeId: 'SngNA6I2zII' },
  ],
  questions: [
    {
      id: 'q1',
      text: 'Los vehículos que son parte de la flota se consideran parte del ambiente de trabajo.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'a',
    },
    {
      id: 'q2',
      text: 'Si un conductor está atento a la maniobra que realizan los otros conductores y los peatones, se denomina:',
      choices: [
        { id: 'a', text: 'Acto temerario' },
        { id: 'b', text: 'Manejo a la defensiva' },
        { id: 'c', text: 'Manejo a la ofensiva' },
      ],
      correct: 'b',
    },
    {
      id: 'q3',
      text: 'Los accidentes tienen más de una causa o factor que contribuyen a que puedan ocurrir. ¿Cuál de estas aseveraciones NO es considerada un acto inseguro?',
      choices: [
        { id: 'a', text: 'Utilizar atajos incorrectamente.' },
        { id: 'b', text: 'Conducir bajo fatiga.' },
        { id: 'c', text: 'Estacionar el vehículo incorrectamente.' },
        { id: 'd', text: 'Dar paso en la vía de los peatones.' },
        { id: 'e', text: 'No usar técnicas de manejo defensivo.' },
      ],
      correct: 'd',
    },
    {
      id: 'q4',
      text: 'Los conductores pueden negarse a usar un vehículo si está en condiciones inseguras.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'a',
    },
    {
      id: 'q5',
      text: 'El uso del celular en la mano por el conductor está permitido cuando:',
      choices: [
        { id: 'a', text: 'El vehículo está estacionado.' },
        { id: 'b', text: 'El vehículo está en movimiento.' },
        { id: 'c', text: 'En ningún momento.' },
        { id: 'd', text: 'En caso de emergencias.' },
      ],
      correct: 'a',
    },
    {
      id: 'q6',
      text: '¿Cuáles son las primeras acciones a tomar al ocurrir un accidente?',
      choices: [
        {
          id: 'a',
          text: 'Admitir la responsabilidad total del accidente, estacionar el vehículo en un lugar seguro, verificar si necesita atención médica, llamar al 911, notificar a Salud y Seguridad.',
        },
        {
          id: 'b',
          text: 'Dirigir el vehículo a un lugar seguro, verificar si necesitas atención médica, llamar al 911, notificar al Supervisor, Salud y Seguridad. Además, completar informe de incidente.',
        },
        {
          id: 'c',
          text: 'Notificar al supervisor, notificar a Salud y Seguridad, verificar si es necesario recibir atención médica, dirigir el vehículo a un lugar seguro y llamar al 911.',
        },
        {
          id: 'd',
          text: 'Llamar al 911, dirigir su vehículo y/o empleados a un lugar seguro, verificar si es necesaria la atención médica, notificar al Supervisor, Safety y completar el informe de incidente.',
        },
      ],
      correct: 'd',
    },
    {
      id: 'q7',
      text: '¿Cuáles son los pasos en un proceso de investigación de accidente?',
      choices: [
        {
          id: 'a',
          text: 'Notificar al supervisor, generar una querella, estabilizar a la persona afectada y completar la forma del seguro.',
        },
        {
          id: 'b',
          text: 'Generar una querella, notificar al Departamento de EHS, completar las formas del seguro y la de investigación de EHS.',
        },
        {
          id: 'c',
          text: 'Generar una querella, dirigirte al centro de salud más cercano y completar las formas del seguro y EHS.',
        },
        {
          id: 'd',
          text: 'Completar las formas, llamar asistencia en la carretera y notificar al supervisor.',
        },
      ],
      correct: 'b',
    },
    {
      id: 'q8',
      text: 'El uso de eslingas es necesario solamente cuando se transporta equipo pesado.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'b',
    },
    {
      id: 'q9',
      text: 'El uso de los sensores del vehículo es opcional dependiendo del área donde se conduce.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'b',
    },
    {
      id: 'q10',
      text: 'En aquellos casos en que se requiera pernoctar con un vehículo oficial, se debe solicitar autorización al momento de completar la reservación en la aplicación de flota.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'a',
    },
    {
      id: 'q11',
      text: 'En la nueva aplicación de flota solo es necesario realizar el check-in.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'b',
    },
    {
      id: 'q12',
      text: '¿Cuál es el procedimiento correcto para realizar una reservación en la aplicación de flota?',
      choices: [
        {
          id: 'a',
          text: 'Entrar al sitio web, acceder con tu contraseña, identificar las personas que estarán en el vehículo y completar todos los encasillados.',
        },
        {
          id: 'b',
          text: 'Entrar al sitio web, acceder con tu contraseña, seleccionar "Nueva Reservación", escoger el vehículo y completar todos los encasillados.',
        },
        {
          id: 'c',
          text: 'Entrar al sitio web, acceder con tu contraseña, seleccionar "Nueva Reservación", escoger el vehículo, completar todos los encasillados y presionar "Reservar".',
        },
        { id: 'd', text: 'Acceder mediante el código QR en caso de no poder entrar al sitio web.' },
        { id: 'e', text: 'Las opciones c y d son correctas.' },
      ],
      correct: 'e',
    },
    {
      id: 'q13',
      text: 'La inspección del vehículo es necesaria solamente la primera vez que se utiliza.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'b',
    },
    {
      id: 'q14',
      text: 'El uso del cinturón de seguridad es requerido en todo momento mientras el vehículo se encuentra en movimiento.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'a',
    },
    {
      id: 'q15',
      text: 'Cuando una colisión pudo haberse prevenido por parte del conductor, el equipo de investigación puede decidir aplicar una o más de las siguientes medidas disciplinarias:',
      choices: [
        { id: 'a', text: 'Adiestramiento adicional en manejo defensivo.' },
        { id: 'b', text: 'Orientación o asesoramiento por parte de gerentes y supervisores.' },
        { id: 'c', text: 'Participación del conductor en los costos del deducible del seguro.' },
        { id: 'd', text: 'Suspensión de empleo y sueldo.' },
        { id: 'e', text: 'Colocación en período probatorio.' },
        { id: 'f', text: 'Todas las anteriores.' },
      ],
      correct: 'f',
    },
    {
      id: 'q16',
      text: 'Si sometes parte de la documentación requerida por una reclamación de accidente, se puede iniciar el proceso con la aseguradora.',
      choices: [
        { id: 'a', text: 'Cierto' },
        { id: 'b', text: 'Falso' },
      ],
      correct: 'b',
    },
  ],
};

// Public view: same shape, answer key removed.
function publicCourse() {
  return {
    ...course,
    questions: course.questions.map(({ correct: _correct, ...q }) => q),
  };
}

module.exports = { course, publicCourse };
