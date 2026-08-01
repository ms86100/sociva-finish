// @ts-nocheck
import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageCropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageSrc: string;
  aspectRatio: number; // width / height, e.g. 1 for square, 16/9 for cover
  onCropComplete: (croppedBlob: Blob) => void;
}

export function ImageCropDialog({
  open,
  onOpenChange,
  imageSrc,
  aspectRatio,
  onCropComplete,
}: ImageCropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Load image
  useEffect(() => {
    if (!open || !imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setImageLoaded(true);
    };
    img.src = imageSrc;
    return () => { setImageLoaded(false); };
  }, [open, imageSrc]);

  // Draw preview
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imageLoaded) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Calculate crop viewport in canvas
    let cropW: number, cropH: number;
    if (aspectRatio >= 1) {
      cropW = cw * 0.85;
      cropH = cropW / aspectRatio;
      if (cropH > ch * 0.85) {
        cropH = ch * 0.85;
        cropW = cropH * aspectRatio;
      }
    } else {
      cropH = ch * 0.85;
      cropW = cropH * aspectRatio;
      if (cropW > cw * 0.85) {
        cropW = cw * 0.85;
        cropH = cropW / aspectRatio;
      }
    }
    const cropX = (cw - cropW) / 2;
    const cropY = (ch - cropH) / 2;

    // Draw image scaled to fill crop area
    const imgAspect = img.width / img.height;
    const cropAspect = cropW / cropH;
    let drawW: number, drawH: number;
    if (imgAspect > cropAspect) {
      drawH = cropH * zoom;
      drawW = drawH * imgAspect;
    } else {
      drawW = cropW * zoom;
      drawH = drawW / imgAspect;
    }
    const drawX = cropX + (cropW - drawW) / 2 + offset.x;
    const drawY = cropY + (cropH - drawH) / 2 + offset.y;

    // Draw full image
    ctx.save();
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore();

    // Darken outside crop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, cw, cropY); // top
    ctx.fillRect(0, cropY + cropH, cw, ch - cropY - cropH); // bottom
    ctx.fillRect(0, cropY, cropX, cropH); // left
    ctx.fillRect(cropX + cropW, cropY, cw - cropX - cropW, cropH); // right

    // Crop border
    ctx.strokeStyle = 'hsl(var(--primary))';
    ctx.lineWidth = 2;
    ctx.strokeRect(cropX, cropY, cropW, cropH);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cropX + (cropW * i) / 3, cropY);
      ctx.lineTo(cropX + (cropW * i) / 3, cropY + cropH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cropX, cropY + (cropH * i) / 3);
      ctx.lineTo(cropX + cropW, cropY + (cropH * i) / 3);
      ctx.stroke();
    }
  }, [imageLoaded, zoom, offset, aspectRatio]);

  useEffect(() => { draw(); }, [draw]);

  // Pointer handlers
  const getPointerPos = (e: React.PointerEvent) => ({ x: e.clientX, y: e.clientY });

  const handlePointerDown = (e: React.PointerEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handlePointerUp = () => setDragging(false);

  const handleCrop = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const cw = canvas.width;
    const ch = canvas.height;

    let cropW: number, cropH: number;
    if (aspectRatio >= 1) {
      cropW = cw * 0.85;
      cropH = cropW / aspectRatio;
      if (cropH > ch * 0.85) { cropH = ch * 0.85; cropW = cropH * aspectRatio; }
    } else {
      cropH = ch * 0.85;
      cropW = cropH * aspectRatio;
      if (cropW > cw * 0.85) { cropW = cw * 0.85; cropH = cropW / aspectRatio; }
    }
    const cropX = (cw - cropW) / 2;
    const cropY = (ch - cropH) / 2;

    // Output canvas at good resolution
    const outW = Math.min(cropAspect(aspectRatio), 1200);
    const outH = outW / aspectRatio;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return;

    // Recalculate image draw params
    const imgAspect = img.width / img.height;
    const cAspect = cropW / cropH;
    let drawW: number, drawH: number;
    if (imgAspect > cAspect) { drawH = cropH * zoom; drawW = drawH * imgAspect; }
    else { drawW = cropW * zoom; drawH = drawW / imgAspect; }
    const drawX = (cropW - drawW) / 2 + offset.x;
    const drawY = (cropH - drawH) / 2 + offset.y;

    // Scale from preview crop to output
    const scaleX = outW / cropW;
    const scaleY = outH / cropH;

    outCtx.drawImage(img, drawX * scaleX, drawY * scaleY, drawW * scaleX, drawH * scaleY);

    outCanvas.toBlob(
      (blob) => { if (blob) onCropComplete(blob); },
      'image/jpeg',
      0.9
    );
  };

  const handleReset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="text-base">Crop Image</DialogTitle>
        </DialogHeader>

        <div
          ref={containerRef}
          className="relative bg-black/90 touch-none select-none"
          style={{ height: 320 }}
        >
          <canvas
            ref={canvasRef}
            width={480}
            height={320}
            className="w-full h-full"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          />
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-3">
            <ZoomOut size={14} className="text-muted-foreground flex-shrink-0" />
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.05}
              onValueChange={([v]) => setZoom(v)}
              className="flex-1"
            />
            <ZoomIn size={14} className="text-muted-foreground flex-shrink-0" />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleReset}>
              <RotateCcw size={14} />
            </Button>
          </div>
        </div>

        <DialogFooter className="p-4 pt-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCrop}>
            Apply Crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function cropAspect(ar: number): number {
  return ar >= 1 ? 1200 : 800;
}
