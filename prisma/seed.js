const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const vehicles = [
  { make: "Mitsubishi", model: "Outlander Sport", licensePlate: "KII828", year: 2023, program: "VCU-Field-Ponce" },
  { make: "Dodge", model: "RAM 2500", licensePlate: "1026911", year: 2019, program: "VCU" },
  { make: "Dodge", model: "RAM 2500", licensePlate: "1026913", year: 2019, program: "VCU" },
  { make: "Dodge", model: "RAM 2500", licensePlate: "1026914", year: 2019, program: "VCU" },
  { make: "Mitsubishi", model: "Outlander", licensePlate: "JHB616", year: 2019, program: "FCTI" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1254185", year: 2026, program: "VCU-Field" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1254191", year: 2026, program: "VCU-Field Ponce" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1249267", year: 2026, program: "VCU-Field" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1206123", year: 2023, program: "VCU-Field" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1205507", year: 2020, program: "VCU-Field-Ponce" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1206121", year: 2023, program: "VCU-Field-Ponce" },
  { make: "Kia", model: "Carnival", licensePlate: "JQT949", year: 2022, program: "FCTI" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1254184", year: 2026, program: "VCU-Field" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1254172", year: 2026, program: "VCU-Field" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1254175", year: 2026, program: "VCU-Field" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1254176", year: 2026, program: "VCU-Field" },
  { make: "Ford", model: "Transit 350", licensePlate: "H109436", year: 2025, program: "VCU Field" },
  { make: "Mitsubishi", model: "Outlander Sport", licensePlate: "KRN281", year: 2026, program: "VCU-Field-Ponce" },
  { make: "Mitsubishi", model: "Outlander Sport", licensePlate: "KTJ536", year: 2026, program: "VCU-Field-Ponce" },
  { make: "Mitsubishi", model: "Outlander Sport", licensePlate: "KTJ533", year: 2026, program: "VCU-MC" },
  { make: "Mitsubishi", model: "Outlander Sport", licensePlate: "KRN280", year: 2026, program: "VCU-MC" },
  { make: "Mitsubishi", model: "Outlander Sport", licensePlate: "KTJ516", year: 2026, program: "VCU-Field" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1249259", year: 2026, program: "PRVCU" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1249258", year: 2026, program: "PRVCU" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1206116", year: 2026, program: "PRVCU" },
  { make: "Dodge", model: "RAM 1500", licensePlate: "1249254", year: 2026, program: "PRVCU" },
];

async function main() {
  console.log(`Seeding ${vehicles.length} vehicles...`);

  for (let i = 0; i < vehicles.length; i++) {
    const vehicleNumber = String(i + 1).padStart(3, '0');
    const vehicle = { vehicleNumber, ...vehicles[i], createdBy: "Seed Script", updatedBy: "Seed Script" };

    await prisma.vehicle.upsert({
      where: { licensePlate: vehicle.licensePlate },
      update: vehicle,
      create: vehicle,
    });
    console.log(`  ✓ ${vehicleNumber} - ${vehicle.make} ${vehicle.model} (${vehicle.licensePlate})`);
  }

  console.log('Done!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());