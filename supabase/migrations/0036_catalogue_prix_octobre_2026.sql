-- Grille de prix du 10/10/2026 et déclinaisons boîte manuelle / automatique
-- (appliquée directement sur la base le 10/10/2026).
update products set designation = 'CHERY TIGGO 2 PRO BOÎTE MANUELLE', model = 'Tiggo 2 Pro BVM', sale_price = 8500000, updated_at = now()
 where sku = 'CHERY-TIGGO-2-PRO';
update products set designation = 'CHERY TIGGO 4 PRO', model = 'Tiggo 4 Pro', sale_price = 11000000, updated_at = now()
 where sku = 'CHERY-TIGGO-4';
update products set designation = 'CHERY TIGGO 7 PRO', model = 'Tiggo 7 Pro', sale_price = 14500000, updated_at = now()
 where sku = 'CHERY-TIGGO-7';
update products set sale_price = 21000000, updated_at = now() where sku = 'CHERY-TIGGO-9';
update products set designation = 'PICK-UP HIMLA 4X4 BOÎTE AUTOMATIQUE', model = 'Himla BVA 4x4', brand = 'Chery', sale_price = 19000000, updated_at = now()
 where sku = 'PICKUP-HIMLA-AT-4X4';

insert into products (organization_id, sku, designation, brand, model, description, sale_price, purchase_price, tax_rate, quantity_on_hand, stock_min, is_active)
select organization_id, 'CHERY-TIGGO-2-PRO-AT', 'CHERY TIGGO 2 PRO BOÎTE AUTOMATIQUE', 'Chery', 'Tiggo 2 Pro BVA',
       replace(description, 'Boîte de vitesses : manuelle 5 rapports', 'Boîte de vitesses : automatique'),
       9500000, 0, 0, 0, 0, true
  from products where sku = 'CHERY-TIGGO-2-PRO'
   and not exists (select 1 from products where sku = 'CHERY-TIGGO-2-PRO-AT');

insert into products (organization_id, sku, designation, brand, model, description, sale_price, purchase_price, tax_rate, quantity_on_hand, stock_min, is_active)
select organization_id, 'PICKUP-HIMLA-MT', 'PICK-UP HIMLA BOÎTE MANUELLE', 'Chery', 'Himla BVM',
       replace(description, '- Automatique, 6 rapports (AT), Type de traction : 4 roues motrices (4x4)', '- Boîte de vitesses : manuelle'),
       17000000, 0, 0, 0, 0, true
  from products where sku = 'PICKUP-HIMLA-AT-4X4'
   and not exists (select 1 from products where sku = 'PICKUP-HIMLA-MT');
