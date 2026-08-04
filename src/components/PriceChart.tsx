import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { View } from 'react-native';
import { PricePoint } from '../types';

type Props = {
  data: PricePoint[];
  width: number;
  height: number;
  color?: string;
};

export function PriceChart({ data, width, height, color = '#2563EB' }: Props) {
  if (data.length < 2) {
    return <View style={{ width, height }} />;
  }

  const padding = 12;
  const rates = data.map((point) => point.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 1;

  const toX = (index: number) =>
    padding + (index / (data.length - 1)) * (width - padding * 2);
  const toY = (rate: number) =>
    padding + (1 - (rate - min) / range) * (height - padding * 2);

  const points = data.map((point, index) => `${toX(index)},${toY(point.rate)}`).join(' ');
  const lastPoint = data[data.length - 1];

  return (
    <Svg width={width} height={height}>
      <Line
        x1={padding}
        y1={height / 2}
        x2={width - padding}
        y2={height / 2}
        stroke="#E2E8F0"
        strokeWidth={1}
      />
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={toX(data.length - 1)} cy={toY(lastPoint.rate)} r={4} fill={color} />
    </Svg>
  );
}
