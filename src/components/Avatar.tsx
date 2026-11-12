/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

interface Props {
  name: string;
  src?: string;
  className?: string;
}

/** Profile photo, or the person's initials when there is none (or it fails to load). */
export const Avatar: React.FC<Props> = ({ name, src, className = 'w-9 h-9' }) => {
  const [failed, setFailed] = useState(false);
  const initials =
    name
      .split(/\s+/)
      .filter((part) => /^[A-Za-z]/.test(part))
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?';
  if (src && !failed) {
    return <img src={src} alt={name} referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${className} rounded-full object-cover`} />;
  }
  return (
    <span
      aria-label={name}
      className={`${className} rounded-full bg-gradient-to-br from-indigo-500 to-emerald-500 text-white font-bold text-xs flex items-center justify-center shrink-0`}
    >
      {initials}
    </span>
  );
};
