import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";

const base = process.env.TEST_MONGO_URI;
if (!base) throw new Error("TEST_MONGO_URI not set; is test/global-setup.ts registered in vitest.config.ts?");

const dbName = `t_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  await mongoose.connect(base, { dbName });
});

beforeEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
});
