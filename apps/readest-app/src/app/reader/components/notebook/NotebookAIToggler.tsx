import React from 'react';
import { TbLayoutSidebarRight, TbLayoutSidebarRightFilled } from 'react-icons/tb';

import { flushNotebookDocument } from '@/app/reader/hooks/useNotebookDocumentCoordinator';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import Button from '@/components/Button';

interface NotebookAITogglerProps {
  bookKey: string;
  className?: string;
}

const NotebookAIToggler: React.FC<NotebookAITogglerProps> = ({ bookKey, className }) => {
  const _ = useTranslation();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { isNotebookVisible, notebookActiveTab, setNotebookActiveTab, setNotebookVisible } =
    useNotebookStore();
  const expanded = sideBarBookKey === bookKey && isNotebookVisible && notebookActiveTab === 'ai';
  const label = expanded ? _('Collapse AI panel') : _('Expand AI panel');

  const handleToggleAI = () => {
    if (sideBarBookKey === bookKey && expanded) {
      void flushNotebookDocument(bookKey);
      setNotebookVisible(false);
      return;
    }

    if (sideBarBookKey !== bookKey) setSideBarBookKey(bookKey);
    setNotebookActiveTab('ai');
    setNotebookVisible(true);
  };

  return (
    <Button
      icon={
        expanded ? (
          <TbLayoutSidebarRightFilled className='text-base-content' />
        ) : (
          <TbLayoutSidebarRight className='text-base-content' />
        )
      }
      onClick={handleToggleAI}
      label={label}
      className={className}
    />
  );
};

export default NotebookAIToggler;
