import mongoose, { Schema, models, model } from 'mongoose';

const UserSchema = new Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // hashed password
  createdAt: { type: Date, default: Date.now },
});

const User = models.User || model('User', UserSchema);

export default User;
