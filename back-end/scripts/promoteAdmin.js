import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const email = process.argv[2] || "admin@hicar.mn";

await mongoose.connect(process.env.MONGO_URI);
const r = await mongoose.connection.db.collection("users").updateOne(
  { email: email.toLowerCase() },
  { $set: { role: "admin" } },
);
console.log(`Promoted ${email}: modified=${r.modifiedCount}`);
await mongoose.disconnect();
process.exit(0);
