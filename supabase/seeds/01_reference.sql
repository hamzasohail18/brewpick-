-- Reference data. Idempotent: safe to re-run.

-- Area centroids are approximate and only used to centre the map / estimate distance when the
-- user picks an area instead of sharing location.
insert into areas (name, name_ur, centroid_lat, centroid_lng) values
  ('DHA',               'ڈی ایچ اے',          31.4750, 74.4100),
  ('Gulberg',           'گلبرگ',              31.5120, 74.3460),
  ('Johar Town',        'جوہر ٹاؤن',          31.4697, 74.2728),
  ('Model Town',        'ماڈل ٹاؤن',          31.4835, 74.3254),
  ('Bahria Town',       'بحریہ ٹاؤن',         31.3670, 74.1830),
  ('Cantt',             'کینٹ',               31.5200, 74.3920),
  ('Mall Road',         'مال روڈ',            31.5600, 74.3270),
  ('Wapda Town',        'واپڈا ٹاؤن',         31.4330, 74.2660),
  ('Garden Town',       'گارڈن ٹاؤن',         31.5000, 74.3220),
  ('Faisal Town',       'فیصل ٹاؤن',          31.4800, 74.3050),
  ('Township',          'ٹاؤن شپ',            31.4500, 74.3100),
  ('Allama Iqbal Town', 'علامہ اقبال ٹاؤن',   31.5100, 74.2850),
  ('Shadman',           'شادمان',             31.5390, 74.3290),
  ('Valencia',          'ویلنسیا',            31.4120, 74.2540)
on conflict (name) do nothing;

insert into allergens (code, name, name_ur) values
  ('dairy',  'Dairy',  'دودھ'),
  ('nuts',   'Nuts',   'میوہ جات'),
  ('gluten', 'Gluten', 'گلوٹین'),
  ('soy',    'Soy',    'سویا')
on conflict (code) do nothing;

insert into ingredients (name, is_dairy, is_vegan) values
  ('espresso',               false, true),
  ('water',                  false, true),
  ('ice',                    false, true),
  ('cold brew concentrate',  false, true),
  ('whole milk',             true,  false),
  ('skimmed milk',           true,  false),
  ('lactose-free milk',      true,  false),
  ('oat milk',               false, true),
  ('almond milk',            false, true),
  ('soy milk',               false, true),
  ('milk foam',              true,  false),
  ('whipped cream',          true,  false),
  ('condensed milk',         true,  false),
  ('chocolate sauce',        true,  false),
  ('caramel sauce',          true,  false),
  ('vanilla syrup',          false, true),
  ('caramel syrup',          false, true),
  ('hazelnut syrup',         false, true),
  ('sugar',                  false, true),
  ('frappe base',            true,  false)
on conflict (name) do nothing;

-- aliases are lowercase; the normalizer lowercases and strips punctuation before matching.
insert into drink_types (slug, name, name_ur, default_temperature, default_espresso_shots, aliases) values
  ('espresso',        'Espresso',        'ایسپریسو',       'hot',  1, '{espresso,single espresso,double espresso,doppio,espresso shot}'),
  ('americano',       'Americano',       'امریکانو',       'hot',  2, '{americano,caffe americano,cafe americano,long black}'),
  ('latte',           'Latte',           'لاٹے',           'hot',  2, '{latte,cafe latte,caffe latte,caffè latte}'),
  ('cappuccino',      'Cappuccino',      'کیپوچینو',       'hot',  2, '{cappuccino,cappucino,capuccino}'),
  ('flat-white',      'Flat White',      'فلیٹ وائٹ',      'hot',  2, '{flat white,flatwhite}'),
  ('cortado',         'Cortado',         'کورٹاڈو',        'hot',  2, '{cortado,gibraltar}'),
  ('macchiato',       'Macchiato',       'میکیاٹو',        'hot',  1, '{macchiato,espresso macchiato}'),
  ('mocha',           'Mocha',           'موکا',           'hot',  2, '{mocha,cafe mocha,caffe mocha,mochaccino}'),
  ('spanish-latte',   'Spanish Latte',   'اسپینش لاٹے',    'hot',  2, '{spanish latte,spanish}'),
  ('caramel-macchiato','Caramel Macchiato','کیریمل میکیاٹو','hot', 2, '{caramel macchiato}'),
  ('iced-latte',      'Iced Latte',      'آئسڈ لاٹے',      'iced', 2, '{iced latte,ice latte,iced cafe latte}'),
  ('iced-americano',  'Iced Americano',  'آئسڈ امریکانو',  'iced', 2, '{iced americano,ice americano}'),
  ('iced-spanish-latte','Iced Spanish Latte','آئسڈ اسپینش لاٹے','iced',2,'{iced spanish latte}'),
  ('cold-brew',       'Cold Brew',       'کولڈ برو',       'iced', null, '{cold brew,coldbrew,cold-brew}'),
  ('frappe',          'Frappe',          'فراپے',          'iced', 1, '{frappe,frappé,frappuccino,blended coffee,coffee frappe}'),
  ('pour-over',       'Pour Over',       'پور اوور',       'hot',  null, '{pour over,pourover,v60,chemex,filter coffee,drip coffee}')
on conflict (slug) do nothing;

-- kcal per 100 ml are generic reference estimates (USDA FoodData Central style values for plain,
-- unsweetened milks). Barista blends differ; record cafe-specific values in nutrition_info instead.
insert into milk_types (slug, name, is_dairy, kcal_per_100ml, notes) values
  ('whole',        'Full-fat milk',     true,  61, 'Reference estimate: whole cow milk ~3.25% fat'),
  ('skimmed',      'Skimmed milk',      true,  34, 'Reference estimate: fat-free cow milk'),
  ('lactose_free', 'Lactose-free milk', true,  61, 'Reference estimate: lactose-free whole milk'),
  ('oat',          'Oat milk',          false, 48, 'Reference estimate: barista oat drinks range ~45-60'),
  ('almond',       'Almond milk',       false, 15, 'Reference estimate: unsweetened almond drink'),
  ('soy',          'Soy milk',          false, 33, 'Reference estimate: unsweetened soy drink')
on conflict (slug) do nothing;

-- Payment methods: names only, used for deal matching. Never card numbers.
insert into payment_methods (kind, name) values
  ('bank_card', 'HBL'),
  ('bank_card', 'UBL'),
  ('bank_card', 'Meezan Bank'),
  ('bank_card', 'Bank Alfalah'),
  ('bank_card', 'Standard Chartered'),
  ('bank_card', 'Faysal Bank'),
  ('bank_card', 'MCB'),
  ('bank_card', 'Bank Al Habib'),
  ('bank_card', 'Allied Bank'),
  ('bank_card', 'Askari Bank'),
  ('bank_card', 'JS Bank'),
  ('bank_card', 'Bank of Punjab'),
  ('wallet',    'JazzCash'),
  ('wallet',    'Easypaisa'),
  ('wallet',    'SadaPay'),
  ('wallet',    'NayaPay'),
  ('delivery_app', 'Foodpanda')
on conflict (kind, name, tier) do nothing;
