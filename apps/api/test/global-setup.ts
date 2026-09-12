import { MongoMemoryServer } from "mongodb-memory-server";

// One mongod for the whole run; each test file gets its own database name via
// test/setup.ts so files never see each other's data.
export default async function () {
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });
  process.env.TEST_MONGO_URI = mongod.getUri();
  return async () => {
    await mongod.stop();
  };
}
