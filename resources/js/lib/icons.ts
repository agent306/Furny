import {
    Archive,
    Armchair,
    BadgeCheck,
    Bell,
    BellRing,
    Calendar,
    Camera,
    CircleX,
    CirclePause,
    CirclePlay,
    FileText,
    FileWarning,
    GitCompare,
    Hammer,
    House,
    ListChecks,
    MessageSquare,
    MonitorSmartphone,
    Package,
    Phone,
    RotateCcw,
    Rotate3d,
    Scan,
    ScanLine,
    Search,
    SearchX,
    SendHorizontal,
    Smile,
    Sparkles,
    ThumbsUp,
    TriangleAlert,
    Truck,
    UserCheck,
} from '@lucide/vue';

/**
 * Typed icon registry (15 §13). Components that take an icon *name*
 * (`EmptyState`, `ActionPanel`, `KpiTile`, notification rows) resolve it here,
 * so only these icons are bundled and a typo is a compile error.
 *
 * Keys keep the kebab-case names the specs use (12 §3.5, 15 §9); where lucide
 * has renamed an icon, the key is the spec's name and the import the current
 * one. Always import icons by name, never `import * as` (`icons.test.ts`).
 * Later tasks add the icons their components need here.
 */
export const ICONS = {
    'alert-triangle': TriangleAlert,
    archive: Archive,
    armchair: Armchair,
    'badge-check': BadgeCheck,
    bell: Bell,
    'bell-ring': BellRing,
    calendar: Calendar,
    camera: Camera,
    'file-text': FileText,
    'file-warning': FileWarning,
    'git-compare': GitCompare,
    hammer: Hammer,
    house: House,
    'list-checks': ListChecks,
    'message-square': MessageSquare,
    'monitor-smartphone': MonitorSmartphone,
    package: Package,
    'pause-circle': CirclePause,
    phone: Phone,
    'play-circle': CirclePlay,
    'rotate-3d': Rotate3d,
    'rotate-ccw': RotateCcw,
    scan: Scan,
    'scan-line': ScanLine,
    search: Search,
    'search-x': SearchX,
    'send-horizontal': SendHorizontal,
    smile: Smile,
    sparkles: Sparkles,
    'thumbs-up': ThumbsUp,
    truck: Truck,
    'user-check': UserCheck,
    'x-circle': CircleX,
} as const;

export type IconName = keyof typeof ICONS;
