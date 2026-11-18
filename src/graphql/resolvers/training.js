const { GraphQLError } = require('graphql');
const { requireTrainingAuth } = require('../../middleware/requireAuth');
const { course, publicCourse } = require('../../training/fleetSafetyCourse');
const { grantVehiclesAccess } = require('../../services/trainingAccess');

function badInput(message) {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function identity(claims) {
  return {
    principalId: claims.oid || claims.sub,
    displayName: claims.name || null,
    email: claims.preferred_username || claims.email || null,
  };
}

function parseVideos(progress) {
  try {
    const ids = JSON.parse(progress?.videosWatched || '[]');
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

async function getProgress(prisma, who) {
  return prisma.trainingProgress.upsert({
    where: { principalId: who.principalId },
    update: { displayName: who.displayName, email: who.email },
    create: { ...who },
  });
}

async function buildStatus(prisma, who, progress) {
  const [attemptCount, lastAttempt, existingRole] = await Promise.all([
    prisma.trainingAttempt.count({ where: { principalId: who.principalId } }),
    prisma.trainingAttempt.findFirst({
      where: { principalId: who.principalId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.appUserRole.findFirst({ where: { principalId: who.principalId } }),
  ]);
  const videosWatched = parseVideos(progress);
  return {
    videosWatched,
    allVideosWatched: course.videos.every((v) => videosWatched.includes(v.id)),
    passed: !!progress.passedAt,
    passedAt: progress.passedAt,
    // Existing drivers assigned by an admin already have access.
    accessGranted: !!progress.accessGrantedAt || !!existingRole,
    accessGrantedAt: progress.accessGrantedAt,
    grantError: progress.grantError,
    attemptCount,
    lastAttempt,
  };
}

// Attempts the Entra assignment and records the outcome on the progress row.
// Never throws: a Graph failure must not lose the user's passing result.
async function tryGrant(prisma, who) {
  try {
    const result = await grantVehiclesAccess({ prisma, ...who });
    await prisma.auditLog.create({
      data: {
        action: 'TRAINING_ACCESS_GRANTED',
        actorId: who.principalId,
        actorName: who.displayName,
        actorEmail: who.email,
        targetType: 'User',
        targetId: who.principalId,
        metadata: JSON.stringify({
          alreadyAssigned: result.alreadyAssigned,
          assignmentId: result.assignment?.id,
          roleName: result.roleName,
          courseVersion: course.version,
        }),
      },
    });
    return prisma.trainingProgress.update({
      where: { principalId: who.principalId },
      data: { accessGrantedAt: new Date(), grantError: null },
    });
  } catch (err) {
    console.error('[training] access grant failed:', err?.message || err);
    return prisma.trainingProgress.update({
      where: { principalId: who.principalId },
      data: { grantError: String(err?.message || err).slice(0, 2000) },
    });
  }
}

const trainingResolvers = {
  Query: {
    trainingCourse: (_, __, context) => {
      requireTrainingAuth(context);
      return publicCourse();
    },

    myTrainingStatus: async (_, __, context) => {
      const who = identity(requireTrainingAuth(context));
      const progress = await getProgress(context.prisma, who);
      return buildStatus(context.prisma, who, progress);
    },
  },

  Mutation: {
    markTrainingVideoWatched: async (_, { videoId }, context) => {
      const who = identity(requireTrainingAuth(context));
      if (!course.videos.some((v) => v.id === videoId)) {
        throw badInput('Unknown video');
      }
      let progress = await getProgress(context.prisma, who);
      const watched = parseVideos(progress);
      if (!watched.includes(videoId)) {
        progress = await context.prisma.trainingProgress.update({
          where: { principalId: who.principalId },
          data: { videosWatched: JSON.stringify([...watched, videoId]) },
        });
      }
      return buildStatus(context.prisma, who, progress);
    },

    submitTrainingAttempt: async (_, { input }, context) => {
      const who = identity(requireTrainingAuth(context));
      const { prisma } = context;
      let progress = await getProgress(prisma, who);

      if (!course.videos.every((v) => parseVideos(progress).includes(v.id))) {
        throw badInput('Debes ver ambos videos antes de tomar la prueba.');
      }
      if (!course.areas.includes(input.area)) {
        throw badInput('Área inválida.');
      }

      const byQuestion = new Map(input.answers.map((a) => [a.questionId, a.choiceId]));
      if (byQuestion.size !== input.answers.length) {
        throw badInput('Respuestas duplicadas.');
      }

      const graded = course.questions.map((q) => {
        const choiceId = byQuestion.get(q.id);
        if (!choiceId || !q.choices.some((c) => c.id === choiceId)) {
          throw badInput('Debes contestar todas las preguntas.');
        }
        return { questionId: q.id, choiceId, correct: choiceId === q.correct };
      });

      const total = graded.length;
      const score = graded.filter((g) => g.correct).length;
      const percentage = Math.round((score / total) * 100);
      const passed = percentage >= course.passingPercentage;

      const attempt = await prisma.trainingAttempt.create({
        data: {
          ...who,
          area: input.area,
          courseVersion: course.version,
          score,
          total,
          percentage,
          passed,
          answers: JSON.stringify(graded),
        },
      });

      if (passed) {
        if (!progress.passedAt) {
          progress = await prisma.trainingProgress.update({
            where: { principalId: who.principalId },
            data: { passedAt: attempt.createdAt },
          });
        }
        if (!progress.accessGrantedAt) {
          progress = await tryGrant(prisma, who);
        }
      }

      return {
        attempt,
        results: graded.map(({ questionId, correct }) => ({ questionId, correct })),
        status: await buildStatus(prisma, who, progress),
      };
    },

    retryTrainingAccessGrant: async (_, __, context) => {
      const who = identity(requireTrainingAuth(context));
      let progress = await getProgress(context.prisma, who);
      if (!progress.passedAt) {
        throw badInput('Debes aprobar la prueba primero.');
      }
      if (!progress.accessGrantedAt) {
        progress = await tryGrant(context.prisma, who);
      }
      return buildStatus(context.prisma, who, progress);
    },
  },
};

module.exports = trainingResolvers;
