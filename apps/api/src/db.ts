import mongoose from "mongoose";

export async function connectDB(url: string): Promise<void> {
  await mongoose.connect(url);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
