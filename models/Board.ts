import mongoose, { Schema, models, model } from 'mongoose';

// Stroke schema for individual drawing strokes
const StrokeSchema = new Schema({
  points: { type: [Number], required: true },
  color: { type: String, required: true },
  width: { type: Number, required: true },
  brushType: { 
    type: String, 
    enum: ['normal', 'rough', 'thin', 'highlighter', 'spray', 'marker'],
    required: true 
  },
  opacity: { type: Number, default: 1 },
  globalCompositeOperation: { 
    type: String, 
    enum: ['source-over', 'destination-out'],
    default: 'source-over'
  }
}, { timestamps: true });

// Shape schema for geometric shapes
const ShapeSchema = new Schema({
  type: { 
    type: String, 
    enum: ['rectangle', 'circle', 'line', 'triangle'],
    required: true 
  },
  startX: { type: Number, required: true },
  startY: { type: Number, required: true },
  endX: { type: Number, required: true },
  endY: { type: Number, required: true },
  color: { type: String, required: true },
  width: { type: Number, required: true },
  opacity: { type: Number, default: 1 },
  globalCompositeOperation: { 
    type: String, 
    enum: ['source-over', 'destination-out'],
    default: 'source-over'
  }
}, { timestamps: true });

// Board schema for individual drawing boards
const BoardSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  strokes: [StrokeSchema],
  shapes: [ShapeSchema],
  backgroundImage: { type: String, default: null }, // base64 string
  bgTransform: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    rotation: { type: Number, default: 0 }
  },
  convertedMusic: { type: String, default: null }, // URL or base64
  thumbnail: { type: String, default: null }, // base64 thumbnail
  isActive: { type: Boolean, default: false },
  order: { type: Number, default: 0 } // for board ordering
}, { timestamps: true });

// User settings schema
const UserSettingsSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  customSwatches: { type: [String], default: ["#7dd3fc","#60a5fa","#a78bfa"] },
  defaultBrushType: { 
    type: String, 
    enum: ['normal', 'rough', 'thin', 'highlighter', 'spray', 'marker'],
    default: 'normal'
  },
  defaultColor: { type: String, default: "#2563eb" },
  defaultWidth: { type: Number, default: 6 }
}, { timestamps: true });

// Gallery schema for saved compositions
const GallerySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  thumbnail: { type: String, required: true }, // base64
  fullImage: { type: String, required: true }, // base64
  trackUrl: { type: String, default: null },
  boards: [{ type: Schema.Types.ObjectId, ref: 'Board' }], // reference to boards used
  description: { type: String, default: '' }
}, { timestamps: true });

// Create models
const Board = models.Board || model('Board', BoardSchema);
const UserSettings = models.UserSettings || model('UserSettings', UserSettingsSchema);
const Gallery = models.Gallery || model('Gallery', GallerySchema);

export { Board, UserSettings, Gallery };
export default Board;
