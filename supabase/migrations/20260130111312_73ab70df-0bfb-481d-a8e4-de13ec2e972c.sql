-- Convert category_config.category from enum to TEXT
ALTER TABLE category_config 
  ALTER COLUMN category TYPE TEXT 
  USING category::TEXT;

-- Convert seller_profiles.categories from enum[] to TEXT[]
ALTER TABLE seller_profiles 
  ALTER COLUMN categories TYPE TEXT[] 
  USING categories::TEXT[];

-- Convert products.category from enum to TEXT
ALTER TABLE products 
  ALTER COLUMN category TYPE TEXT 
  USING category::TEXT;