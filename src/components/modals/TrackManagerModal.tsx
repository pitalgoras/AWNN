import React from 'react';
import { ModalShell } from './ModalShell';
import { TrackListEditor } from '../settings/TrackListEditor';

interface Props { show: boolean; onClose: () => void }

export const TrackManagerModal: React.FC<Props> = ({ show, onClose }) => (
  <ModalShell show={show} onClose={onClose} title="Manage Tracks" maxWidth="max-w-md">
    <TrackListEditor />
  </ModalShell>
);
