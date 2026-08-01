
-- Add bcp47_tag and ai_name to supported_languages for dynamic TTS
ALTER TABLE public.supported_languages
ADD COLUMN bcp47_tag text NOT NULL DEFAULT 'hi-IN',
ADD COLUMN ai_name text NOT NULL DEFAULT 'Hindi';

-- Update existing languages with correct values
UPDATE public.supported_languages SET bcp47_tag = 'hi-IN', ai_name = 'Hindi (Devanagari script)' WHERE code = 'hi';
UPDATE public.supported_languages SET bcp47_tag = 'en-IN', ai_name = 'English' WHERE code = 'en';
UPDATE public.supported_languages SET bcp47_tag = 'ta-IN', ai_name = 'Tamil' WHERE code = 'ta';
UPDATE public.supported_languages SET bcp47_tag = 'te-IN', ai_name = 'Telugu' WHERE code = 'te';
UPDATE public.supported_languages SET bcp47_tag = 'bn-IN', ai_name = 'Bengali' WHERE code = 'bn';
UPDATE public.supported_languages SET bcp47_tag = 'mr-IN', ai_name = 'Marathi' WHERE code = 'mr';
UPDATE public.supported_languages SET bcp47_tag = 'kn-IN', ai_name = 'Kannada' WHERE code = 'kn';
UPDATE public.supported_languages SET bcp47_tag = 'gu-IN', ai_name = 'Gujarati' WHERE code = 'gu';
UPDATE public.supported_languages SET bcp47_tag = 'ml-IN', ai_name = 'Malayalam' WHERE code = 'ml';
UPDATE public.supported_languages SET bcp47_tag = 'pa-IN', ai_name = 'Punjabi (Gurmukhi script)' WHERE code = 'pa';
