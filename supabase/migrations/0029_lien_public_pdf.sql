-- Lien public de consultation du PDF par le client final (WhatsApp/Email) :
-- un jeton aléatoire propre à chaque document, distinct de son identifiant
-- (lui visible dans le QR code de vérification). Le lien ne donne accès
-- qu'au PDF de ce document, rien d'autre. Appliqué le 04/10.
alter table documents add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists idx_documents_public_token on documents(public_token);
