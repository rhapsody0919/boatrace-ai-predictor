import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../hooks/useLocalizedPath";
import "./Footer.css";

function Footer({ links = [], extra = null, copyrightText }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();

  return (
    <footer className="site-footer">
      {extra}
      {links.length > 0 && (
        <div className="site-footer-links">
          {links.map((link) => (
            <Link key={link.to} to={localize(link.to)}>
              {link.label}
            </Link>
          ))}
        </div>
      )}
      <p className="site-footer-copyright">
        {copyrightText ?? t("footer.copyright")}
      </p>
    </footer>
  );
}

export default Footer;
