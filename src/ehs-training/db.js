const prisma = require('../config/prisma');

// Comparte la misma instancia de PrismaClient (y el mismo Azure SQL) que el resto de
// vehicles-backend. Modelos EhsUser/EhsTraining/EhsReservation mapean a las tablas
// ehs_users/ehs_trainings/ehs_reservations (ver prisma/schema.prisma).

const usersRepo = {
  findByEmail(email) {
    return prisma.ehsUser.findUnique({ where: { email } });
  },
  findById(id) {
    return prisma.ehsUser.findUnique({ where: { id } });
  },
  async upsert({ email, name, jobTitle, department, isAdmin }) {
    return prisma.ehsUser.upsert({
      where: { email },
      update: { name, jobTitle: jobTitle || null, department: department || null, isAdmin },
      create: { email, name, jobTitle: jobTitle || null, department: department || null, isAdmin },
    });
  },
};

const trainingsRepo = {
  list() {
    return prisma.ehsTraining.findMany({ orderBy: { startAt: 'asc' } });
  },
  findById(id) {
    return prisma.ehsTraining.findUnique({ where: { id } });
  },
  create({ title, description, location, startAt, endAt, capacity, createdBy }) {
    return prisma.ehsTraining.create({
      data: {
        title,
        description: description || null,
        location: location || null,
        startAt: new Date(startAt),
        endAt: endAt ? new Date(endAt) : null,
        capacity: Number(capacity) || 20,
        createdBy: createdBy || null,
      },
    });
  },
  async update(id, changes) {
    const existing = await this.findById(id);
    if (!existing) return null;
    return prisma.ehsTraining.update({
      where: { id },
      data: {
        title: changes.title,
        description: changes.description,
        location: changes.location,
        startAt: changes.startAt ? new Date(changes.startAt) : undefined,
        endAt: changes.endAt ? new Date(changes.endAt) : changes.endAt === null ? null : undefined,
        capacity: changes.capacity,
      },
    });
  },
  async remove(id) {
    // onDelete: Cascade en EhsReservation.training se encarga de las reservaciones asociadas.
    await prisma.ehsTraining.delete({ where: { id } }).catch(() => null);
  },
};

const reservationsRepo = {
  listByTraining(trainingId) {
    return prisma.ehsReservation.findMany({ where: { trainingId } });
  },
  listByUser(userId) {
    return prisma.ehsReservation.findMany({ where: { userId } });
  },
  findByTrainingAndUser(trainingId, userId) {
    return prisma.ehsReservation.findUnique({ where: { trainingId_userId: { trainingId, userId } } });
  },
  findById(id) {
    return prisma.ehsReservation.findUnique({ where: { id } });
  },
  countConfirmed(trainingId) {
    return prisma.ehsReservation.count({ where: { trainingId, status: 'confirmed' } });
  },
  create({ trainingId, userId }) {
    return prisma.ehsReservation.create({
      data: { trainingId, userId, status: 'confirmed' },
    });
  },
  setStatus(id, status) {
    return prisma.ehsReservation
      .update({ where: { id }, data: { status, reservedAt: new Date() } })
      .catch(() => null);
  },
  checkin(id, byEmail) {
    return prisma.ehsReservation
      .update({ where: { id }, data: { checkedInAt: new Date(), checkedInBy: byEmail } })
      .catch(() => null);
  },
  undoCheckin(id) {
    return prisma.ehsReservation
      .update({ where: { id }, data: { checkedInAt: null, checkedInBy: null } })
      .catch(() => null);
  },
};

module.exports = { usersRepo, trainingsRepo, reservationsRepo };
