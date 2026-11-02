import React from 'react';
import {
  Bell,
  Package,
  AlertTriangle,
  Users,
  Wallet,
  TrendingUp,
  Target,
  BarChart3,
  Cloud,
  Download,
  Clock,
  CheckCircle2,
  Flame,
  ShieldAlert,
  Sparkles,
  Calendar,
} from 'lucide-react';
import type { NotificationIconName, NotificationStyleVariant } from '../types';
import { getNotificationColorTheme } from '../utils/notificationDefaults';

interface NotificationIconProps {
  icon?: NotificationIconName;
  className?: string;
}

export const NotificationGlyph: React.FC<NotificationIconProps> = ({
  icon = 'Bell',
  className = 'w-4 h-4',
}) => {
  switch (icon) {
    case 'Package':
      return <Package className={className} />;
    case 'AlertTriangle':
      return <AlertTriangle className={className} />;
    case 'Users':
      return <Users className={className} />;
    case 'Wallet':
      return <Wallet className={className} />;
    case 'TrendingUp':
      return <TrendingUp className={className} />;
    case 'Target':
      return <Target className={className} />;
    case 'BarChart3':
      return <BarChart3 className={className} />;
    case 'Cloud':
      return <Cloud className={className} />;
    case 'Download':
      return <Download className={className} />;
    case 'Clock':
      return <Clock className={className} />;
    case 'CheckCircle2':
      return <CheckCircle2 className={className} />;
    case 'Flame':
      return <Flame className={className} />;
    case 'ShieldAlert':
      return <ShieldAlert className={className} />;
    case 'Sparkles':
      return <Sparkles className={className} />;
    case 'Calendar':
      return <Calendar className={className} />;
    case 'Bell':
    default:
      return <Bell className={className} />;
  }
};

export function getStyledNotificationClasses(
  colorId?: string,
  styleVariant: NotificationStyleVariant = 'soft'
): {
  cardClass: string;
  iconBoxClass: string;
  titleClass: string;
  bodyClass: string;
  actionBtnClass: string;
  unreadDotClass: string;
  isSolid: boolean;
} {
  const theme = getNotificationColorTheme(colorId);
  switch (styleVariant) {
    case 'solid':
      return {
        cardClass: theme.solidCard,
        iconBoxClass: theme.solidIconBox,
        titleClass: theme.solidTitle,
        bodyClass: theme.solidBody,
        actionBtnClass: theme.actionBtnSolid,
        unreadDotClass: 'bg-white',
        isSolid: true,
      };
    case 'outlined':
      return {
        cardClass: theme.outlinedCard,
        iconBoxClass: theme.outlinedIconBox,
        titleClass: theme.outlinedTitle,
        bodyClass: theme.outlinedBody,
        actionBtnClass: theme.actionBtn,
        unreadDotClass: theme.unreadDot,
        isSolid: false,
      };
    case 'minimal':
      return {
        cardClass: theme.minimalCard,
        iconBoxClass: theme.minimalIconBox,
        titleClass: theme.minimalTitle,
        bodyClass: theme.minimalBody,
        actionBtnClass: theme.actionBtn,
        unreadDotClass: theme.unreadDot,
        isSolid: false,
      };
    case 'soft':
    default:
      return {
        cardClass: theme.softCard,
        iconBoxClass: theme.softIconBox,
        titleClass: theme.softTitle,
        bodyClass: theme.softBody,
        actionBtnClass: theme.actionBtn,
        unreadDotClass: theme.unreadDot,
        isSolid: false,
      };
  }
}
