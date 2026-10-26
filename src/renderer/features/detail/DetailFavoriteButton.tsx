export interface DetailFavoriteButtonProps {
  favorited: boolean;
  disabled: boolean;
  onToggle: () => void;
}

/** Passive favorite control; identity, storage, and synchronization stay in the detail application boundary. */
export function DetailFavoriteButton({ favorited, disabled, onToggle }: DetailFavoriteButtonProps) {
  return (
    <button
      type="button"
      className={`fav-btn${favorited ? ' active' : ''}`}
      disabled={disabled}
      aria-pressed={favorited}
      title={favorited ? '取消收藏' : '加入收藏（在「收藏」页查看）'}
      onClick={onToggle}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
      </svg>
      {favorited ? '已收藏' : '收藏'}
    </button>
  );
}
