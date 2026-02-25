export const POI_COLORS: Record<number, string> = {
  0x010101: '#ff3d5a', // Mobile Speed Camera
  0x010102: '#e6294e', // Fixed Speed Camera
  0x010103: '#cc1a3f', // Average Speed Camera
  0x010104: '#ff4081', // Red Light Camera
  0x010105: '#e91e63', // Speed & Red Light
  0x010106: '#c2185b', // Helicopter
  0x010107: '#ad1457', // Distance Control
  0x010200: '#ff6e40', // Spot Check
  0x010100: '#ff5252', // Camera (generic)
  0x010000: '#ff1744', // Law Enforcement (generic)
  0x020100: '#ffc107', // Car On Shoulder
  0x020200: '#ff9100', // Accident
  0x020300: '#8d6e63', // Animal Nearby
  0x020400: '#66bb6a', // School Road
  0x020500: '#42a5f5', // Emergency Vehicle
  0x020000: '#ffab40', // Danger (generic)
  0x030101: '#ce93d8', // Congestion
  0x030202: '#ffb300', // Roadworks
  0x030000: '#ba68c8', // Delay (generic)
};

export function getPoiColor(typeCode: number): string {
  return POI_COLORS[typeCode] || '#78909c';
}

// Map POI category codes to icon labels
export function getPoiIcon(typeCode: number): string {
  const category = typeCode >> 16;
  if (category === 1) return '\u{26A0}'; // warning - law enforcement
  if (category === 2) return '\u{26D4}'; // danger
  if (category === 3) return '\u{1F6A7}'; // delay/roadworks
  return '\u{2B24}'; // filled circle
}
