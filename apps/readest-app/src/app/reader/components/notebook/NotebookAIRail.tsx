import clsx from 'clsx';
import React from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';

interface NotebookAIRailProps {
  expanded: boolean;
  onToggle: () => void;
  variant: 'attached' | 'floating';
  style?: React.CSSProperties;
}

const NotebookAIRail: React.FC<NotebookAIRailProps> = ({ expanded, onToggle, variant, style }) => {
  const _ = useTranslation();
  const label = expanded ? _('Collapse AI panel') : _('Expand AI panel');

  return (
    <button
      type='button'
      aria-label={label}
      aria-expanded={expanded}
      aria-controls='notebook-panel'
      title={label}
      data-ai-rail={variant}
      onClick={onToggle}
      className={clsx(
        'notebook-ai-rail group border-base-300 bg-base-100 text-base-content/60 flex h-[85px] w-8 shrink-0 items-center justify-center rounded-l-md border border-r-0 shadow-sm transition-colors',
        'hover:bg-base-200 hover:text-primary focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2',
        variant === 'floating'
          ? 'fixed top-1/2 z-30 -translate-y-1/2'
          : 'absolute left-0 top-1/2 z-10 -translate-x-full -translate-y-1/2',
      )}
      style={style}
    >
      {expanded ? <PanelRightClose className='h-5 w-5' /> : <PanelRightOpen className='h-5 w-5' />}
    </button>
  );
};

export default NotebookAIRail;
