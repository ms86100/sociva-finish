
-- Create parent_groups table
CREATE TABLE public.parent_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.parent_groups ENABLE ROW LEVEL SECURITY;

-- Anyone can read active parent groups
CREATE POLICY "Anyone can view active parent groups"
ON public.parent_groups
FOR SELECT
USING (is_active = true OR is_admin(auth.uid()));

-- Only admins can manage parent groups
CREATE POLICY "Only admins can manage parent groups"
ON public.parent_groups
FOR ALL
USING (is_admin(auth.uid()));

-- Create indexes
CREATE INDEX idx_parent_groups_slug ON public.parent_groups (slug);
CREATE INDEX idx_parent_groups_sort_order ON public.parent_groups (sort_order);

-- Add updated_at trigger
CREATE TRIGGER update_parent_groups_updated_at
BEFORE UPDATE ON public.parent_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Seed with existing parent groups
INSERT INTO public.parent_groups (slug, name, icon, color, description, sort_order) VALUES
  ('food', 'Food & Groceries', '🍲', 'bg-orange-100 text-orange-600', 'Homemade food, snacks & daily essentials', 1),
  ('classes', 'Classes & Learning', '📚', 'bg-indigo-100 text-indigo-600', 'Yoga, dance, music, tuition & more', 2),
  ('services', 'Home Services', '🛠️', 'bg-blue-100 text-blue-600', 'Electrician, plumber, repairs & help', 3),
  ('personal', 'Personal Care', '💇', 'bg-pink-100 text-pink-600', 'Beauty, salon, tailoring & laundry', 4),
  ('professional', 'Professional Help', '💼', 'bg-emerald-100 text-emerald-600', 'Tax, IT support & consultations', 5),
  ('rentals', 'Rentals', '🚲', 'bg-teal-100 text-teal-600', 'Equipment, party supplies & more', 6),
  ('resale', 'Buy & Sell', '📦', 'bg-amber-100 text-amber-600', 'Pre-owned furniture, electronics & items', 7),
  ('events', 'Events', '🎉', 'bg-violet-100 text-violet-600', 'Catering, decoration & photography', 8),
  ('pets', 'Pet Services', '🐕', 'bg-lime-100 text-lime-600', 'Pet food, grooming & sitting', 9),
  ('property', 'Property', '🏢', 'bg-slate-100 text-slate-600', 'Flats for rent, roommates & parking', 10);

-- Add foreign key from category_config.parent_group to parent_groups.slug
ALTER TABLE public.category_config
ADD CONSTRAINT fk_category_config_parent_group
FOREIGN KEY (parent_group) REFERENCES public.parent_groups(slug)
ON UPDATE CASCADE ON DELETE RESTRICT;
