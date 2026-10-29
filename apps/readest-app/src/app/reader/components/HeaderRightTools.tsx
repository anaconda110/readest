import React, { useState } from 'react';
import { MdOutlineMenu } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { useTranslation } from '@/hooks/useTranslation';
import Dropdown from '@/components/Dropdown';
import ModalPortal from '@/components/ModalPortal';
import WindowButtons from '@/components/WindowButtons';
import NotebookToggler from './NotebookToggler';
import NotebookAIToggler from './notebook/NotebookAIToggler';
import ViewMenu from './ViewMenu';
import SyncInfoDialog from './SyncInfoDialog';

interface HeaderRightToolsProps {
  bookKey: string;
  // The reader header hides the AI entry while the panel it opens is visible;
  // the notebook header hosts this cluster then and keeps the toggle so the
  // panel can be collapsed from the same spot.
  showAIToggler?: boolean;
  headerRef?: React.RefObject<HTMLElement | null>;
  onCloseBook: (bookKey: string) => void;
  onDropdownOpenChange?: (isOpen: boolean) => void;
}

/**
 * The reader header's right-hand cluster: notebook, view menu, AI entry and
 * the window buttons. Shared with the notebook header so that, while the
 * notebook panel is open, the cluster renders there — at the window's
 * top-right corner — instead of sliding left with the shrunken book area.
 */
const HeaderRightTools: React.FC<HeaderRightToolsProps> = ({
  bookKey,
  showAIToggler = true,
  headerRef,
  onCloseBook,
  onDropdownOpenChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { bookKeys, setHoveredBookKey } = useReaderStore();
  const { getBookData, getConfig } = useBookDataStore();
  const { isTrafficLightVisible, trafficLightInFullscreen } = useTrafficLightStore();
  const [isMetaHashDialogOpen, setIsMetaHashDialogOpen] = useState(false);

  const bookData = getBookData(bookKey);
  const bookConfig = getConfig(bookKey);
  // Readest Cloud's per-book stamps. Includes the PUSH stamps so this agrees
  // with the View menu's sync row, which has always counted them — otherwise
  // the row could read "Synced 2 minutes ago" while this dialog said "Never
  // synced" for the same book.
  const nativeLastSyncedAt =
    Math.max(
      bookConfig?.lastSyncedAtConfig || 0,
      bookConfig?.lastSyncedAtNotes || 0,
      bookConfig?.lastPushedAtConfig || 0,
      bookConfig?.lastPushedAtNotes || 0,
    ) || undefined;

  // macOS owns the window buttons via its traffic lights, so this only ever
  // matters on desktop platforms where `hasTrafficLight` is false anyway and
  // the reader header's extra traffic-light terms fall out.
  const windowButtonVisible =
    !!appService?.hasWindowBar && !isTrafficLightVisible && !trafficLightInFullscreen;

  const handleToggleDropdown = (isOpen: boolean) => {
    if (!isOpen) setHoveredBookKey('');
    onDropdownOpenChange?.(isOpen);
  };

  return (
    <>
      <NotebookToggler bookKey={bookKey} />
      <Dropdown
        label={_('View Options')}
        containerClassName='h-8'
        className='exclude-title-bar-mousedown dropdown-bottom dropdown-end'
        buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0 mt-0'
        toggleButton={<MdOutlineMenu />}
        onToggle={handleToggleDropdown}
      >
        <ViewMenu bookKey={bookKey} onShowMetaHashDialog={() => setIsMetaHashDialogOpen(true)} />
      </Dropdown>
      {isMetaHashDialogOpen && (
        <ModalPortal showOverlay={false}>
          <SyncInfoDialog
            isOpen={isMetaHashDialogOpen}
            bookKey={bookKey}
            metadata={bookData?.bookDoc?.metadata ?? bookData?.book?.metadata}
            storedMetaHash={bookData?.book?.metaHash}
            nativeLastSyncedAt={nativeLastSyncedAt}
            onClose={() => setIsMetaHashDialogOpen(false)}
          />
        </ModalPortal>
      )}
      {showAIToggler && (
        <div className='hidden sm:flex'>
          <NotebookAIToggler bookKey={bookKey} />
        </div>
      )}
      <WindowButtons
        className='window-buttons flex items-center'
        headerRef={headerRef}
        showMinimize={bookKeys.length == 1 && windowButtonVisible}
        showMaximize={bookKeys.length == 1 && windowButtonVisible}
        closeButtonLabel={_('Close Book')}
        onClose={() => {
          setHoveredBookKey(null);
          onCloseBook(bookKey);
        }}
      />
    </>
  );
};

export default HeaderRightTools;
