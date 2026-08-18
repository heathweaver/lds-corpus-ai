SET search_path = lds_corpus, public;
BEGIN;

-- Repository
INSERT INTO repository (id, slug, name, base_url) VALUES
 ('00000000-0000-0000-0000-000000000001','churchofjesuschrist','Gospel Library','https://www.churchofjesuschrist.org');

-- Works
INSERT INTO work (id, canonical_key, preferred_title, work_type, start_date) VALUES
 ('00000000-0000-0000-0000-000000000010','book-of-mormon','The Book of Mormon','scripture','1830-01-01'),
 ('00000000-0000-0000-0000-000000000011','lectures-on-faith','Lectures on Faith','doctrine','1835-01-01');

-- Documents
INSERT INTO document (id, canonical_key, work_id, document_type, title, publication_start, edition_label) VALUES
 ('00000000-0000-0000-0000-000000000020','bofm:alma-32','00000000-0000-0000-0000-000000000010','book','Alma','1830-03-26','1981 edition'),
 ('00000000-0000-0000-0000-000000000021','lof:lecture-1','00000000-0000-0000-0000-000000000011','lecture','Lectures on Faith, Lecture First','1835-01-01','1835 edition');

-- Content nodes (reading order via sequence)
INSERT INTO content_node (id, document_id, node_type, label, sequence, stable_slug) VALUES
 ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020','verse','Alma 32:21',21,'alma-32-21'),
 ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000020','verse','Alma 32:27',27,'alma-32-27'),
 ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000021','paragraph','Lecture 1:1',1,'lof-1-1');

-- Repository copies (carry source_url)
INSERT INTO repository_copy (id, document_id, repository_id, external_record_id, source_url) VALUES
 ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','bofm-alma-32','https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32'),
 ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','lof-1','https://www.churchofjesuschrist.org/study/manual/lectures-on-faith/lecture-1');

-- Text layers
INSERT INTO text_layer (id, content_node_id, repository_copy_id, layer_type, text, text_hash) VALUES
 ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000040','transcription','And now as I said concerning faith—faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.','h1'),
 ('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000040','transcription','But behold, if ye will awake and arouse your faculties, even to an experiment upon my words, and exercise a particle of faith, yea, even if ye can no more than desire to believe, let this desire work in you.','h2'),
 ('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000041','transcription','Faith being the first principle in revealed religion, and the foundation of all righteousness, necessarily claims the first place in a course of lectures which are designed to unfold to the understanding the doctrine of Jesus Christ.','h3');

-- Segments (prev/next chain within Alma; FTS via generated search_vector)
INSERT INTO segment (id, segment_key, document_id, segment_type, canonical_text_layer_id, text, token_count, segmenter_name, segmenter_version, input_hash) VALUES
 ('00000000-0000-0000-0000-000000000060','bofm:alma-32-21','00000000-0000-0000-0000-000000000020','verse','00000000-0000-0000-0000-000000000050','And now as I said concerning faith—faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.',34,'verse','1','s1'),
 ('00000000-0000-0000-0000-000000000061','bofm:alma-32-27','00000000-0000-0000-0000-000000000020','verse','00000000-0000-0000-0000-000000000051','But behold, if ye will awake and arouse your faculties, even to an experiment upon my words, and exercise a particle of faith, yea, even if ye can no more than desire to believe, let this desire work in you.',44,'verse','1','s2'),
 ('00000000-0000-0000-0000-000000000062','lof:1-1','00000000-0000-0000-0000-000000000021','paragraph','00000000-0000-0000-0000-000000000052','Faith being the first principle in revealed religion, and the foundation of all righteousness, necessarily claims the first place in a course of lectures which are designed to unfold to the understanding the doctrine of Jesus Christ.',40,'paragraph','1','s3');

-- Wire the reading-order chain now that both rows exist (trigger-safe).
UPDATE segment SET next_segment_id='00000000-0000-0000-0000-000000000061' WHERE id='00000000-0000-0000-0000-000000000060';
UPDATE segment SET previous_segment_id='00000000-0000-0000-0000-000000000060' WHERE id='00000000-0000-0000-0000-000000000061';

-- Segment ↔ content node (drives sources jsonb + ordering)
INSERT INTO segment_node (segment_id, content_node_id, text_layer_id, ordinal) VALUES
 ('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000050',0),
 ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000051',0),
 ('00000000-0000-0000-0000-000000000062','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000052',0);

-- Author (Lectures on Faith)
INSERT INTO agent (id, agent_type, preferred_name, sort_name) VALUES
 ('00000000-0000-0000-0000-000000000070','person','Joseph Smith','Smith, Joseph');
INSERT INTO contribution (id, document_id, agent_id, role) VALUES
 ('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000070','author');

-- Theme index 1: Faith and Belief
INSERT INTO theme_index (id, slug, title, investigative_question, thesis, status) VALUES
 ('00000000-0000-0000-0000-000000000080','faith-and-belief','Faith and Belief','How is faith described as a principle of action and hope?','Faith is trust that precedes perfect knowledge and motivates experiment upon the word.','published');
INSERT INTO theme_index_version (id, theme_index_id, version, markdown_text, content_hash, review_status) VALUES
 ('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000080',1,'# Faith and Belief','c1','approved');
UPDATE theme_index SET current_version_id='00000000-0000-0000-0000-000000000081' WHERE id='00000000-0000-0000-0000-000000000080';
INSERT INTO index_section (id, theme_index_version_id, heading, sequence, stable_slug) VALUES
 ('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000081','Faith precedes knowledge',1,'faith-precedes-knowledge');
INSERT INTO index_paragraph (id, index_section_id, sequence, markdown_text, content_hash) VALUES
 ('00000000-0000-0000-0000-000000000083','00000000-0000-0000-0000-000000000082',1,'Alma teaches that faith is not perfect knowledge but hope in unseen truths, and invites an experiment upon the word.','p1');
INSERT INTO support_link (id, index_paragraph_id, claim_start_char, claim_end_char, segment_id, support_type, support_strength, verifier_status) VALUES
 ('00000000-0000-0000-0000-000000000084','00000000-0000-0000-0000-000000000083',0,40,'00000000-0000-0000-0000-000000000060','supports',0.95,'verified'),
 ('00000000-0000-0000-0000-000000000085','00000000-0000-0000-0000-000000000083',41,80,'00000000-0000-0000-0000-000000000061','supports',0.90,'verified');

-- Theme index 2: Experiment on the Word (shares segment ...061 with theme 1)
INSERT INTO theme_index (id, slug, title, investigative_question, thesis, status) VALUES
 ('00000000-0000-0000-0000-000000000090','experiment-on-the-word','Experiment on the Word','What does it mean to experiment upon the word?','A desire to believe, exercised as an experiment, is the seed of faith.','published');
INSERT INTO theme_index_version (id, theme_index_id, version, markdown_text, content_hash, review_status) VALUES
 ('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000090',1,'# Experiment on the Word','c2','approved');
UPDATE theme_index SET current_version_id='00000000-0000-0000-0000-000000000091' WHERE id='00000000-0000-0000-0000-000000000090';
INSERT INTO index_section (id, theme_index_version_id, heading, sequence, stable_slug) VALUES
 ('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000091','The experiment',1,'the-experiment');
INSERT INTO index_paragraph (id, index_section_id, sequence, markdown_text, content_hash) VALUES
 ('00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000092',1,'Faith begins as a particle—a desire to believe that is put to the test.','p2');
INSERT INTO support_link (id, index_paragraph_id, claim_start_char, claim_end_char, segment_id, support_type, support_strength, verifier_status) VALUES
 ('00000000-0000-0000-0000-000000000094','00000000-0000-0000-0000-000000000093',0,40,'00000000-0000-0000-0000-000000000061','supports',0.88,'verified');

COMMIT;
