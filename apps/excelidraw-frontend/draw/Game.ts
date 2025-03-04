import { getExistingShapes } from "./http";

type Tool = "circle" | "rect" | "pencil" | "eraser" | "move";

type Shape =
  | { type: "rect"; x: number; y: number; width: number; height: number }
  | { type: "circle"; centerX: number; centerY: number; radius: number }
  | { type: "pencil"; points: { x: number; y: number }[] }
  | { type: "move"; shape: Shape; offsetX: number; offsetY: number }
  | { type: "eraser"; x: number; y: number; width: number; height: number };

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private existingShapes: Shape[] = [];
  private roomId: string;
  private clicked: boolean = false;
  private startX: number = 0;
  private startY: number = 0;
  private selectedTool: Tool = "pencil";
  private currentPencilStroke: { x: number; y: number }[] = [];
  private activeShape: Shape | null = null;
  private currentMouseX: number = 0;
  private currentMouseY: number = 0;

  socket: WebSocket;

  constructor(canvas: HTMLCanvasElement, roomId: string, socket: WebSocket) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.roomId = roomId;
    this.socket = socket;
    this.init();
    this.initHandlers();
    this.initMouseHandlers();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.mouseDownHandler);
    this.canvas.removeEventListener("mouseup", this.mouseUpHandler);
    this.canvas.removeEventListener("mousemove", this.mouseMoveHandler);
  }

  setTool(tool: Tool) {
    this.selectedTool = tool;
    this.canvas.style.cursor = tool === "move" ? "move" : "crosshair";
  }

  async init() {
    this.existingShapes = await getExistingShapes(this.roomId);
    this.redrawCanvas();
  }

  initHandlers() {
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "chat") {
        const parsedShape = JSON.parse(message.message);
        if (parsedShape.type === "update") {
          this.existingShapes = parsedShape.shapes;
        } else {
          this.existingShapes.push(parsedShape.shape);
        }
        this.redrawCanvas();
      }
    };
  }

  redrawCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.existingShapes.forEach((shape) => this.drawShape(shape));
  }

  drawShape(shape: Shape) {
    this.ctx.strokeStyle = "white";
    if (shape.type === "rect") {
      this.ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
    } else if (shape.type === "pencil") {
      if (shape.points.length > 0) {
        this.ctx.beginPath();
        this.ctx.moveTo(shape.points[0].x, shape.points[0].y);
        shape.points.forEach((point) => this.ctx.lineTo(point.x, point.y));
        this.ctx.stroke();
        this.ctx.closePath();
      }
    } else if (shape.type === "circle") {
      this.ctx.beginPath();
      this.ctx.arc(shape.centerX, shape.centerY, shape.radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.closePath();
    } else if (shape.type === "move") {
      // Apply the move transform and draw the underlying shape
      const movedShape = this.getMovedShape(shape);
      this.drawShape(movedShape);
    }
  }

  getMovedShape(moveShape: Shape & { type: "move" }): Shape {
    const { shape, offsetX, offsetY } = moveShape;
    switch (shape.type) {
      case "rect":
        return {
          ...shape,
          x: shape.x + offsetX,
          y: shape.y + offsetY,
        };
      case "circle":
        return {
          ...shape,
          centerX: shape.centerX + offsetX,
          centerY: shape.centerY + offsetY,
        };
      case "pencil":
        return {
          ...shape,
          points: shape.points.map(point => ({
            x: point.x + offsetX,
            y: point.y + offsetY,
          })),
        };
      default:
        return shape;
    }
  }

  mouseDownHandler = (e: MouseEvent) => {
    this.clicked = true;
    const rect = this.canvas.getBoundingClientRect();
    this.startX = e.clientX - rect.left;
    this.startY = e.clientY - rect.top;
    this.currentMouseX = this.startX;
    this.currentMouseY = this.startY;

    if (this.selectedTool === "pencil") {
      this.currentPencilStroke = [{ x: this.startX, y: this.startY }];
    } else if (this.selectedTool === "eraser") {
      this.eraseShape(this.startX, this.startY);
    } else if (this.selectedTool === "move") {
      const shapeToMove = [...this.existingShapes].reverse().find((shape) => {
        if (shape.type === "rect") {
          return (
            this.startX >= shape.x &&
            this.startX <= shape.x + shape.width &&
            this.startY >= shape.y &&
            this.startY <= shape.y + shape.height
          );
        } else if (shape.type === "circle") {
          return (
            Math.hypot(this.startX - shape.centerX, this.startY - shape.centerY) <= shape.radius
          );
        } else if (shape.type === "pencil") {
          return shape.points.some(
            (point) => Math.hypot(this.startX - point.x, this.startY - point.y) <= 10
          );
        }
        return false;
      });

      if (shapeToMove) {
        this.existingShapes = this.existingShapes.filter((shape) => shape !== shapeToMove);
        const moveShape = {
          type: "move" as const,
          shape: shapeToMove,
          offsetX: 0,
          offsetY: 0,
        };
        this.activeShape = moveShape;
        this.existingShapes.push(moveShape);
        this.redrawCanvas();
      }
    }
  };

  mouseUpHandler = (e: MouseEvent) => {
    if (!this.clicked) return;
    
    this.clicked = false;
    const rect = this.canvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    let newShape: Shape | null = null;

    if (this.selectedTool === "rect") {
      const width = endX - this.startX;
      const height = endY - this.startY;
      if (Math.abs(width) > 1 && Math.abs(height) > 1) {
        newShape = {
          type: "rect",
          x: Math.min(this.startX, endX),
          y: Math.min(this.startY, endY),
          width: Math.abs(width),
          height: Math.abs(height),
        };
      }
    } else if (this.selectedTool === "circle") {
      const radius = Math.hypot(endX - this.startX, endY - this.startY);
      if (radius > 1) {
        newShape = { type: "circle", centerX: this.startX, centerY: this.startY, radius };
      }
    } else if (this.selectedTool === "pencil" && this.currentPencilStroke.length > 1) {
      newShape = { type: "pencil", points: this.currentPencilStroke };
    } else if (this.selectedTool === "move" && this.activeShape) {
      // Finalize the move by applying the transformation
      const moveShape = this.activeShape as Shape & { type: "move" };
      const finalShape = this.getMovedShape(moveShape);
      this.existingShapes = this.existingShapes.filter(shape => shape !== moveShape);
      this.existingShapes.push(finalShape);
      
      // Broadcast the entire shape array to maintain consistency
      this.socket.send(
        JSON.stringify({
          type: "chat",
          message: JSON.stringify({ type: "update", shapes: this.existingShapes }),
          roomId: this.roomId,
        })
      );
      
      this.activeShape = null;
      this.redrawCanvas();
      return;
    }

    if (newShape) {
      this.existingShapes.push(newShape);
      this.socket.send(
        JSON.stringify({
          type: "chat",
          message: JSON.stringify({ shape: newShape }),
          roomId: this.roomId,
        })
      );
    }

    this.redrawCanvas();
  };

  mouseMoveHandler = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    this.currentMouseX = x;
    this.currentMouseY = y;

    if (!this.clicked) return;

    if (this.selectedTool === "rect") {
      this.redrawCanvas();
      const width = x - this.startX;
      const height = y - this.startY;
      this.ctx.strokeRect(
        Math.min(this.startX, x),
        Math.min(this.startY, y),
        Math.abs(width),
        Math.abs(height)
      );
    } else if (this.selectedTool === "circle") {
      this.redrawCanvas();
      const radius = Math.hypot(x - this.startX, y - this.startY);
      this.ctx.beginPath();
      this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.closePath();
    } else if (this.selectedTool === "pencil") {
      this.currentPencilStroke.push({ x, y });
      this.ctx.beginPath();
      this.ctx.moveTo(this.currentPencilStroke[0].x, this.currentPencilStroke[0].y);
      this.currentPencilStroke.forEach((point) => this.ctx.lineTo(point.x, point.y));
      this.ctx.stroke();
      this.ctx.closePath();
    } else if (this.selectedTool === "eraser") {
      this.eraseShape(x, y);
    } else if (this.selectedTool === "move" && this.activeShape) {
      const moveShape = this.activeShape as Shape & { type: "move" };
      moveShape.offsetX = x - this.startX;
      moveShape.offsetY = y - this.startY;
      this.redrawCanvas();
    }
  };

  eraseShape(x: number, y: number) {
    const threshold = 10;
    this.existingShapes = this.existingShapes.filter((shape) => {
      if (shape.type === "rect") {
        return !(x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height);
      } else if (shape.type === "circle") {
        return Math.hypot(x - shape.centerX, y - shape.centerY) > shape.radius;
      } else if (shape.type === "pencil") {
        return shape.points.every((point) => Math.hypot(x - point.x, y - point.y) > threshold);
      }
      return true;
    });

    this.redrawCanvas();
  }

  initMouseHandlers() {
    this.canvas.addEventListener("mousedown", this.mouseDownHandler);
    this.canvas.addEventListener("mouseup", this.mouseUpHandler);
    this.canvas.addEventListener("mousemove", this.mouseMoveHandler);
  }
}