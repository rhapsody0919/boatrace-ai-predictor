import {
  TITLE,
  DESCRIPTION,
  buildPersonSchema,
  buildBreadcrumbSchema,
} from "./ProfileSchema";

export function ProfileHead() {
  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
      <link rel="canonical" href="https://www.boat-ai.jp/profile" />

      {/* Person Schema */}
      <script type="application/ld+json">
        {JSON.stringify(buildPersonSchema())}
      </script>

      {/* BreadcrumbList */}
      <script type="application/ld+json">
        {JSON.stringify(buildBreadcrumbSchema())}
      </script>
    </>
  );
}
