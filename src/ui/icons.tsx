import type { ComponentType, SVGProps } from 'react'
import {
  AlertTriangle, Bell, BookOpen, Bookmark, Briefcase, Calendar, Camera, CheckCircle2, Clock, Cloud, Code2, Database,
  DollarSign, FileText, Flag, Flame, Folder, Gift, Globe, GraduationCap, Heart, HelpCircle, Home, Key, Leaf, Lightbulb,
  Link2, Lock, Mail, MapPin, Moon, Music, Pencil, Phone, Rocket, Search, Settings, Shield, ShoppingCart, Star, Sun, Tag,
  Target, ThumbsDown, ThumbsUp, Trophy, User, Users, Zap, BarChart3, Image as ImageIcon,
} from 'lucide-react'

export type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>

/** Curated icons a node can wear. Keys are stored in documents as "lucide:<key>". */
export const lucideIcons: Record<string, IconCmp> = {
  star: Star, heart: Heart, flag: Flag, bookmark: Bookmark, lightbulb: Lightbulb, check: CheckCircle2,
  warning: AlertTriangle, question: HelpCircle, target: Target, rocket: Rocket, calendar: Calendar, clock: Clock,
  user: User, users: Users, mail: Mail, phone: Phone, globe: Globe, link: Link2, file: FileText, folder: Folder,
  image: ImageIcon, music: Music, camera: Camera, code: Code2, database: Database, settings: Settings, shield: Shield,
  lock: Lock, key: Key, tag: Tag, trophy: Trophy, zap: Zap, flame: Flame, leaf: Leaf, sun: Sun, moon: Moon, cloud: Cloud,
  money: DollarSign, cart: ShoppingCart, book: BookOpen, learn: GraduationCap, work: Briefcase, home: Home,
  pin: MapPin, up: ThumbsUp, down: ThumbsDown, bell: Bell, gift: Gift, edit: Pencil, search: Search, chart: BarChart3,
}

export const EMOJIS = [
  '🚀', '💡', '✅', '❓', '⚠️', '⭐', '🔥', '🎯', '📌', '📅', '💬', '❤️', '👍', '👎', '🎉', '🧠', '📈', '📉', '💰', '🔒',
  '🔑', '🌱', '☀️', '🌙', '⚡', '🐛', '🧪', '🛠️', '📚', '🏆', '🚫', '✏️', '🎨', '🎵', '🏠', '✈️', '🍎', '☕', '🔔', '🧩',
]

export function NodeIcon({ icon, size = 16, color }: { icon: string; size?: number; color?: string }) {
  if (icon.startsWith('emoji:')) return <span style={{ fontSize: size, lineHeight: 1 }}>{icon.slice(6)}</span>
  const C = lucideIcons[icon.replace(/^lucide:/, '')]
  return C ? <C size={size} strokeWidth={2.1} style={{ color }} /> : null
}
