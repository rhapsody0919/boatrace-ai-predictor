import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './Breadcrumb.css';

export default function Breadcrumb({ items }) {
  const { t } = useTranslation();
  return (
    <nav className="breadcrumb" aria-label={t('breadcrumbLabel')}>
      <ol className="breadcrumb-list">
        {items.map((item, index) => (
          <li key={index} className="breadcrumb-item">
            {index < items.length - 1 ? (
              <>
                <Link to={item.url}>{item.name}</Link>
                <span className="breadcrumb-separator">›</span>
              </>
            ) : (
              <span className="breadcrumb-current">{item.name}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
