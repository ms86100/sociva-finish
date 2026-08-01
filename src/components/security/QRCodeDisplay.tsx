// @ts-nocheck
import { QRCodeSVG } from 'qrcode.react';

interface QRCodeDisplayProps {
  value: string;
  size?: number;
}

export default function QRCodeDisplay({ value, size = 200 }: QRCodeDisplayProps) {
  return (
    <div className="flex items-center justify-center">
      <div className="bg-white p-3 rounded-xl shadow-sm inline-block">
        <QRCodeSVG
          value={value}
          size={size}
          level="M"
          includeMargin={false}
        />
      </div>
    </div>
  );
}
