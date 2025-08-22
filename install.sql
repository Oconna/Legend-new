-- Strategiespiel Datenbank Schema
-- Erstellt für railway.app MySQL

-- Rassen Tabelle
CREATE TABLE races (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    color_hex VARCHAR(7) DEFAULT '#000000',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Geländetypen Tabelle
CREATE TABLE terrain_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE,
    movement_cost INT NOT NULL DEFAULT 1,
    color_hex VARCHAR(7) DEFAULT '#FFFFFF',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Gebäudetypen Tabelle
CREATE TABLE building_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE,
    gold_income INT NOT NULL DEFAULT 0,
    max_health INT NOT NULL DEFAULT 100,
    color_hex VARCHAR(7) DEFAULT '#CCCCCC',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Einheiten Tabelle (pro Rasse)
CREATE TABLE units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    race_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    cost INT NOT NULL DEFAULT 100,
    attack_power INT NOT NULL DEFAULT 10,
    health INT NOT NULL DEFAULT 100,
    movement_points INT NOT NULL DEFAULT 2,
    attack_range INT NOT NULL DEFAULT 1,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE,
    UNIQUE KEY unique_race_unit (race_id, name)
);

-- Spiele Tabelle
CREATE TABLE games (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    max_players INT NOT NULL DEFAULT 8,
    current_players INT NOT NULL DEFAULT 0,
    map_size INT NOT NULL DEFAULT 30,
    status ENUM('waiting', 'race_selection', 'playing', 'finished') DEFAULT 'waiting',
    current_turn_player_id INT DEFAULT NULL,
    turn_number INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    finished_at TIMESTAMP NULL
);

-- Spieler in Spielen Tabelle
CREATE TABLE game_players (
    id INT PRIMARY KEY AUTO_INCREMENT,
    game_id INT NOT NULL,
    player_name VARCHAR(50) NOT NULL,
    socket_id VARCHAR(100),
    race_id INT DEFAULT NULL,
    gold INT NOT NULL DEFAULT 1000,
    is_ready BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    turn_order INT DEFAULT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE SET NULL,
    UNIQUE KEY unique_game_player (game_id, player_name)
);

-- Spielkarten Tabelle
CREATE TABLE game_maps (
    id INT PRIMARY KEY AUTO_INCREMENT,
    game_id INT NOT NULL,
    x_coordinate INT NOT NULL,
    y_coordinate INT NOT NULL,
    terrain_type_id INT NOT NULL,
    building_type_id INT DEFAULT NULL,
    owner_player_id INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (terrain_type_id) REFERENCES terrain_types(id),
    FOREIGN KEY (building_type_id) REFERENCES building_types(id) ON DELETE SET NULL,
    FOREIGN KEY (owner_player_id) REFERENCES game_players(id) ON DELETE SET NULL,
    UNIQUE KEY unique_game_coordinate (game_id, x_coordinate, y_coordinate)
);

-- Einheiten auf der Karte Tabelle
CREATE TABLE game_units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    game_id INT NOT NULL,
    player_id INT NOT NULL,
    unit_id INT NOT NULL,
    x_coordinate INT NOT NULL,
    y_coordinate INT NOT NULL,
    current_health INT NOT NULL,
    movement_points_left INT NOT NULL,
    has_attacked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES game_players(id) ON DELETE CASCADE,
    FOREIGN KEY (unit_id) REFERENCES units(id),
    UNIQUE KEY unique_game_unit_position (game_id, x_coordinate, y_coordinate)
);

-- Kampflog Tabelle (optional für Statistiken)
CREATE TABLE battle_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    game_id INT NOT NULL,
    attacker_unit_id INT NOT NULL,
    defender_unit_id INT,
    attacker_damage INT NOT NULL DEFAULT 0,
    defender_damage INT NOT NULL DEFAULT 0,
    attacker_survived BOOLEAN DEFAULT TRUE,
    defender_survived BOOLEAN DEFAULT TRUE,
    turn_number INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (attacker_unit_id) REFERENCES game_units(id) ON DELETE CASCADE,
    FOREIGN KEY (defender_unit_id) REFERENCES game_units(id) ON DELETE CASCADE
);

-- Indizes für bessere Performance
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_game_players_game_id ON game_players(game_id);
CREATE INDEX idx_game_maps_game_id ON game_maps(game_id);
CREATE INDEX idx_game_maps_coordinates ON game_maps(game_id, x_coordinate, y_coordinate);
CREATE INDEX idx_game_units_game_id ON game_units(game_id);
CREATE INDEX idx_game_units_player_id ON game_units(player_id);
CREATE INDEX idx_game_units_coordinates ON game_units(game_id, x_coordinate, y_coordinate);

-- Beispieldaten einfügen

-- Terrain Types
INSERT INTO terrain_types (name, movement_cost, color_hex, description) VALUES
('Gras', 1, '#90EE90', 'Normales Grasland, einfach zu durchqueren'),
('Berg', 3, '#8B4513', 'Bergiges Gelände, schwer passierbar'),
('Sumpf', 2, '#556B2F', 'Sumpfiges Gebiet, erschwerte Bewegung'),
('Wasser', 99, '#4169E1', 'Tiezes Wasser, nur für schwimmende Einheiten'),
('Wald', 2, '#228B22', 'Dichter Wald, mäßig schwer passierbar'),
('Wüste', 2, '#F4A460', 'Sandwüste, erschwerte Bewegung'),
('Schnee', 2, '#F0F8FF', 'Verschneites Gelände, kalt und schwer passierbar');

-- Building Types
INSERT INTO building_types (name, gold_income, max_health, color_hex, description) VALUES
('Stadt', 100, 200, '#FFD700', 'Große Stadt, bringt viel Gold pro Runde'),
('Burg', 150, 300, '#708090', 'Befestigte Burg, hoher Goldertrag und robust');

-- Beispiel Rassen
INSERT INTO races (name, description, color_hex) VALUES
('Menschen', 'Ausgewogene Rasse mit vielseitigen Einheiten', '#FF6B6B'),
('Elfen', 'Schnelle und magisch begabte Wesen', '#4ECDC4'),
('Zwerge', 'Robuste Krieger mit starken Verteidigungseinheiten', '#45B7D1'),
('Orks', 'Aggressive Krieger mit hoher Angriffskraft', '#96CEB4'),
('Untote', 'Dunkle Magie und regenerative Fähigkeiten', '#FECA57'),
('Drachen', 'Mächtige fliegende Einheiten', '#FF9FF3'),
('Goblins', 'Schwache aber zahlreiche und billige Einheiten', '#54A0FF'),
('Dämonen', 'Magische Wesen mit besonderen Fähigkeiten', '#5F27CD'),
('Engel', 'Heilige Krieger mit Lichtmagie', '#00D2D3'),
('Trolle', 'Langsame aber sehr starke Einheiten', '#FF6348'),
('Vampire', 'Lebensstehlende Nachtkrieger', '#2F3542'),
('Zentauren', 'Schnelle berittene Kämpfer', '#A55A3C'),
('Riesen', 'Extrem starke aber teure Einheiten', '#786FA6'),
('Elementare', 'Magische Wesen der vier Elemente', '#F8B500'),
('Bestien', 'Wilde Kreaturen mit besonderen Instinkten', '#78E08F');

-- SQL-Script: Einheiten für alle 15 Rassen (je 10 Einheiten pro Rasse)

-- ==================================================
-- RASSE 1: MENSCHEN (Ausgewogene Rasse)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(1, 'Milizionär', 60, 8, 50, 2, 1, 'Einfacher Bürgersoldat, günstig aber schwach'),
(1, 'Krieger', 80, 15, 80, 2, 1, 'Grundlegender Nahkämpfer mit solider Ausrüstung'),
(1, 'Bogenschütze', 100, 12, 60, 2, 3, 'Fernkämpfer mit hoher Reichweite'),
(1, 'Ritter', 150, 20, 120, 3, 1, 'Schwer gepanzerter Kavallerist'),
(1, 'Kleriker', 120, 10, 70, 2, 1, 'Heilende Unterstützungseinheit'),
(1, 'Magier', 200, 25, 50, 2, 2, 'Mächtiger Zauberer mit Fernangriffen'),
(1, 'Späher', 90, 12, 55, 4, 1, 'Schnelle Aufklärungseinheit'),
(1, 'Paladin', 300, 28, 150, 2, 1, 'Elitekrieger mit heiligen Kräften'),
(1, 'Balliste', 250, 35, 80, 1, 4, 'Schwere Belagerungswaffe'),
(1, 'General', 400, 22, 100, 3, 1, 'Befehlshaber, verstärkt nahe Einheiten');

-- ==================================================
-- RASSE 2: ELFEN (Schnelle und magische Wesen)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(2, 'Elfenwache', 70, 10, 55, 3, 2, 'Wendiger Grenzsoldat'),
(2, 'Waldläufer', 90, 14, 70, 3, 2, 'Meister des Bogenschießens'),
(2, 'Dryade', 140, 12, 85, 2, 1, 'Waldgeist mit Naturkräften'),
(2, 'Sternenschütze', 130, 20, 65, 2, 4, 'Präziser Fernkämpfer mit magischen Pfeilen'),
(2, 'Einhornreiter', 220, 20, 90, 4, 1, 'Magischer berittener Kämpfer'),
(2, 'Elfenmagier', 180, 28, 45, 2, 3, 'Meister der Naturmagie'),
(2, 'Mondpriesterin', 160, 15, 80, 2, 2, 'Heilerin mit Mondmagie'),
(2, 'Sturmfalke', 120, 16, 50, 5, 1, 'Schnelle fliegende Einheit'),
(2, 'Baumhirte', 280, 18, 140, 1, 1, 'Lebender Baum als Beschützer'),
(2, 'Elfenherr', 350, 25, 110, 3, 1, 'Adeliger Elfenanführer');

-- ==================================================
-- RASSE 3: ZWERGE (Robuste Krieger)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(3, 'Zwergenwache', 85, 12, 90, 1, 1, 'Standhafter Tunnelwächter'),
(3, 'Zwergenkämpfer', 100, 18, 100, 1, 1, 'Robuster Nahkämpfer mit Axt'),
(3, 'Armbrustschütze', 110, 16, 80, 1, 3, 'Präziser Fernkämpfer'),
(3, 'Minenarbeiter', 80, 10, 120, 1, 1, 'Kann Befestigungen errichten'),
(3, 'Hammergarde', 180, 22, 130, 1, 1, 'Elite-Leibwächter mit Kriegshammer'),
(3, 'Berserker', 160, 25, 90, 2, 1, 'Wilder Krieger im Kampfrausch'),
(3, 'Runenmagier', 200, 20, 70, 2, 2, 'Magier mit Runenzauber'),
(3, 'Schildwall', 140, 12, 160, 1, 1, 'Defensive Einheit mit großem Schild'),
(3, 'Steinbrecher', 220, 35, 110, 1, 1, 'Spezialist gegen Gebäude'),
(3, 'Zwergenkönig', 400, 28, 180, 2, 1, 'Mächtiger Herrscher der Berge');

-- ==================================================
-- RASSE 4: ORKS (Aggressive Krieger)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(4, 'Ork-Grunzer', 50, 12, 65, 2, 1, 'Primitive aber zahlreiche Kämpfer'),
(4, 'Ork-Krieger', 75, 18, 85, 2, 1, 'Brutaler Nahkämpfer mit Keule'),
(4, 'Speerwerfer', 90, 15, 70, 2, 2, 'Wirft schwere Speere auf Feinde'),
(4, 'Wolfsreiter', 130, 20, 80, 4, 1, 'Schneller Kavallerist auf Riesenwolf'),
(4, 'Ork-Schamane', 160, 22, 60, 2, 2, 'Wilde Magie und Flüche'),
(4, 'Bergtroll', 200, 30, 150, 1, 1, 'Massiver Kämpfer mit enormer Kraft'),
(4, 'Kriegshäuptling', 180, 25, 110, 2, 1, 'Erfahrener Stammesführer'),
(4, 'Katapult', 220, 32, 90, 1, 3, 'Primitive aber effektive Belagerungswaffe'),
(4, 'Blutrüstung', 250, 28, 120, 2, 1, 'Elite-Ork in magischer Rüstung'),
(4, 'Großhäuptling', 350, 35, 140, 2, 1, 'Oberster Anführer aller Ork-Stämme');

-- ==================================================
-- RASSE 5: UNTOTE (Dunkle Magie)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(5, 'Skelett-Krieger', 60, 10, 40, 2, 1, 'Wiederbelebter Knochen-Soldat'),
(5, 'Zombie', 50, 8, 60, 1, 1, 'Langsamer aber hartnäckiger Untoter'),
(5, 'Geist', 110, 15, 50, 3, 1, 'Ätherisches Wesen, schwer zu treffen'),
(5, 'Skelett-Bogenschütze', 80, 12, 45, 2, 3, 'Untoter Fernkämpfer'),
(5, 'Ghul', 120, 18, 80, 2, 1, 'Schneller Fleischfresser'),
(5, 'Nekromant', 200, 25, 70, 2, 2, 'Meister der Totenbeschwörung'),
(5, 'Vampir', 250, 22, 90, 3, 1, 'Edler Blutsauger mit Regeneration'),
(5, 'Knochendrache', 300, 35, 120, 4, 2, 'Untotes Drachenskelett'),
(5, 'Banshee', 180, 20, 65, 3, 2, 'Heulender Rachegeist'),
(5, 'Lichkönig', 400, 30, 150, 2, 3, 'Unsterblicher Herrscher der Untoten');

-- ==================================================
-- RASSE 6: DRACHEN (Mächtige fliegende Einheiten)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(6, 'Drachen-Welpe', 120, 15, 80, 3, 1, 'Junger Drache, noch nicht ausgewachsen'),
(6, 'Kobold-Diener', 70, 8, 50, 2, 1, 'Treuer Diener der Drachenherren'),
(6, 'Drachenreiter', 180, 20, 90, 4, 2, 'Mensch auf kleinem Drachen'),
(6, 'Feuerdrache', 280, 35, 140, 4, 2, 'Klassischer feuerspeiender Drache'),
(6, 'Eisdrache', 290, 30, 160, 3, 2, 'Drache der Kälte und des Eises'),
(6, 'Drachenpriester', 200, 22, 100, 2, 3, 'Magier im Dienst der Drachen'),
(6, 'Giftdrache', 270, 28, 130, 4, 2, 'Drache mit tödlichem Giftatem'),
(6, 'Kristalldrache', 320, 32, 180, 3, 3, 'Drache aus purem Kristall'),
(6, 'Schattendrache', 350, 40, 150, 5, 2, 'Meister der Dunkelheit'),
(6, 'Drachenkaiser', 500, 45, 220, 4, 3, 'Uralter Herrscher aller Drachen');

-- ==================================================
-- RASSE 7: GOBLINS (Schwache aber zahlreiche Einheiten)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(7, 'Goblin-Späher', 40, 6, 30, 3, 1, 'Kleiner flinker Kundschafter'),
(7, 'Goblin-Krieger', 50, 8, 40, 2, 1, 'Schwacher aber billiger Kämpfer'),
(7, 'Goblin-Bogenschütze', 60, 7, 35, 2, 2, 'Ungenaue aber günstige Fernkämpfer'),
(7, 'Warg-Reiter', 90, 12, 55, 4, 1, 'Goblin auf Riesenwolf'),
(7, 'Goblin-Saboteur', 80, 10, 45, 3, 1, 'Spezialist für Hinterhalte'),
(7, 'Goblin-Schamane', 120, 15, 50, 2, 2, 'Primitive Magie und Heilung'),
(7, 'Troll-Söldner', 160, 25, 120, 1, 1, 'Angeheurter Troll-Kämpfer'),
(7, 'Goblin-Maschine', 140, 20, 70, 1, 3, 'Primitive Belagerungswaffe'),
(7, 'Goblin-König', 200, 18, 80, 2, 1, 'Anführer der Goblin-Horde'),
(7, 'Riesentroll', 250, 35, 180, 1, 1, 'Massiver geheuerte Kreatur');

-- ==================================================
-- RASSE 8: DÄMONEN (Magische Wesen)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(8, 'Imp', 80, 10, 40, 3, 2, 'Kleiner aber listiger Dämon'),
(8, 'Dämonenwächter', 120, 18, 80, 2, 1, 'Gehörnter Nahkämpfer aus der Hölle'),
(8, 'Sukkubus', 150, 16, 70, 3, 2, 'Verführerischer Dämon mit Charme'),
(8, 'Höllenreiter', 180, 22, 90, 4, 1, 'Dämon auf feurigem Ross'),
(8, 'Feuerelemental', 200, 28, 100, 2, 2, 'Lebende Flamme aus der Hölle'),
(8, 'Dämonenlord', 280, 30, 120, 2, 2, 'Mächtiger Höllenfürst'),
(8, 'Höllendrache', 320, 35, 140, 4, 3, 'Dämonischer Drache'),
(8, 'Schatten-Assassine', 160, 25, 60, 4, 1, 'Meuchler aus purer Dunkelheit'),
(8, 'Höllenmaschine', 240, 32, 110, 1, 4, 'Dämonische Belagerungswaffe'),
(8, 'Dämonenprinz', 400, 40, 160, 3, 3, 'Herrscher einer Höllenebene');

-- ==================================================
-- RASSE 9: ENGEL (Heilige Krieger)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(9, 'Cherub', 90, 12, 60, 3, 2, 'Kleiner Schutzengel'),
(9, 'Engelswächter', 130, 18, 90, 2, 1, 'Himmlischer Beschützer'),
(9, 'Seraph', 180, 22, 100, 3, 2, 'Sechsflügeliger Kämpfer'),
(9, 'Lichtpriester', 160, 20, 80, 2, 3, 'Heiler mit göttlicher Macht'),
(9, 'Pegasus-Reiter', 200, 25, 110, 4, 1, 'Engel auf geflügeltem Pferd'),
(9, 'Erzengel', 280, 30, 130, 3, 2, 'Mächtiger himmlischer Krieger'),
(9, 'Lichtelemental', 220, 28, 120, 2, 3, 'Reines Licht in physischer Form'),
(9, 'Himmelswächter', 240, 26, 140, 2, 2, 'Beschützer der Himmelstore'),
(9, 'Ophanim', 300, 32, 150, 3, 3, 'Räderengel mit multiplen Augen'),
(9, 'Gotteskrieger', 450, 40, 180, 3, 3, 'Champion des göttlichen Willens');

-- ==================================================
-- RASSE 10: TROLLE (Langsame aber starke Einheiten)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(10, 'Jungtroll', 100, 15, 100, 1, 1, 'Noch wachsender Troll'),
(10, 'Waldtroll', 140, 20, 130, 1, 1, 'Troll aus den tiefen Wäldern'),
(10, 'Bergtroll', 160, 25, 150, 1, 1, 'Troll aus den hohen Bergen'),
(10, 'Sumpftroll', 130, 18, 140, 1, 1, 'Troll aus modrigen Sümpfen'),
(10, 'Troll-Werfer', 180, 22, 120, 1, 3, 'Wirft massive Felsbrocken'),
(10, 'Eistroll', 200, 28, 160, 1, 1, 'Troll aus ewigem Eis'),
(10, 'Troll-Schamane', 220, 24, 130, 1, 2, 'Magisch begabter Troll'),
(10, 'Höhlentroll', 240, 30, 180, 1, 1, 'Uralter Troll aus tiefen Höhlen'),
(10, 'Riesentroll', 300, 35, 200, 1, 1, 'Gigantischer Ur-Troll'),
(10, 'Trollkönig', 400, 40, 250, 1, 1, 'Anführer aller Troll-Stämme');

-- ==================================================
-- RASSE 11: VAMPIRE (Lebensstehlende Nachtkrieger)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(11, 'Vampir-Spawn', 110, 14, 70, 3, 1, 'Neugeborener Vampir'),
(11, 'Blutdiener', 80, 10, 60, 2, 1, 'Menschlicher Diener der Vampire'),
(11, 'Vampir-Lord', 200, 22, 100, 3, 1, 'Adeliger Vampir mit Macht'),
(11, 'Fledermausschwarm', 120, 16, 50, 5, 1, 'Schwarm vampirischer Fledermäuse'),
(11, 'Vampir-Hexe', 180, 20, 80, 2, 2, 'Vampirin mit dunkler Magie'),
(11, 'Blutmagier', 160, 18, 75, 2, 3, 'Magier der Blutmagie'),
(11, 'Vampir-Ritter', 240, 26, 110, 3, 1, 'Untote Kavallerie'),
(11, 'Schattenwolf', 150, 20, 85, 4, 1, 'Vampirischer Werwolf'),
(11, 'Vampirfürst', 320, 30, 130, 3, 2, 'Mächtiger Herrscher der Nacht'),
(11, 'Urvampir', 450, 35, 160, 3, 2, 'Erster und mächtigster Vampir');

-- ==================================================
-- RASSE 12: ZENTAUREN (Schnelle berittene Kämpfer)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(12, 'Zentauren-Späher', 90, 12, 70, 4, 2, 'Schneller Kundschafter'),
(12, 'Zentauren-Krieger', 120, 18, 90, 3, 1, 'Krieger mit Lanze'),
(12, 'Zentauren-Bogenschütze', 130, 16, 80, 3, 3, 'Meisterschütze zu Pferd'),
(12, 'Waldzentraur', 140, 20, 100, 3, 1, 'Naturverbundener Kämpfer'),
(12, 'Zentauren-Schamane', 160, 18, 85, 2, 2, 'Priester der Naturgeister'),
(12, 'Windläufer', 180, 22, 95, 4, 1, 'Schnellster der Zentauren'),
(12, 'Zentauren-Champion', 220, 26, 120, 3, 1, 'Elite-Krieger mit Tradition'),
(12, 'Sturmzentraur', 200, 24, 110, 3, 2, 'Wettermagier zu Pferd'),
(12, 'Zentauren-Lord', 280, 28, 140, 3, 1, 'Adeliger Anführer der Herden'),
(12, 'Urzentaur', 350, 32, 160, 4, 1, 'Weiser Stammesältester');

-- ==================================================
-- RASSE 13: RIESEN (Extrem starke aber teure Einheiten)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(13, 'Riesenknecht', 180, 25, 150, 2, 1, 'Kleinster der Riesen'),
(13, 'Steinriese', 250, 30, 180, 2, 1, 'Riese aus lebendigen Felsen'),
(13, 'Feuerriese', 280, 35, 160, 2, 2, 'Riese der Flammen'),
(13, 'Frostgiagnt', 270, 32, 170, 2, 2, 'Riese aus ewigem Eis'),
(13, 'Sturmriese', 300, 28, 140, 2, 3, 'Riese der Winde und Blitze'),
(13, 'Erdriese', 320, 38, 200, 1, 1, 'Riese der Berge und Erde'),
(13, 'Himmelriese', 350, 30, 160, 2, 4, 'Riese aus den Wolken'),
(13, 'Schattenriese', 330, 34, 180, 2, 2, 'Riese aus purer Dunkelheit'),
(13, 'Titanenkrieger', 400, 42, 220, 2, 1, 'Krieger der Urgötter'),
(13, 'Riesen-König', 500, 45, 250, 2, 2, 'Herrscher aller Riesen');

-- ==================================================
-- RASSE 14: ELEMENTARE (Magische Wesen der Elemente)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(14, 'Feuer-Wisp', 70, 10, 40, 3, 2, 'Kleine Feuerflamme'),
(14, 'Wasser-Geist', 80, 8, 60, 2, 2, 'Elemental des fließenden Wassers'),
(14, 'Erd-Golem', 140, 20, 120, 1, 1, 'Erschaffung aus Stein und Erde'),
(14, 'Luft-Elemental', 110, 14, 70, 4, 2, 'Wesen aus Wind und Sturm'),
(14, 'Feuer-Elemental', 160, 25, 80, 2, 2, 'Lebende Flamme mit Macht'),
(14, 'Wasser-Elemental', 150, 18, 100, 2, 2, 'Fließendes Wasser mit Bewusstsein'),
(14, 'Erd-Elemental', 200, 28, 140, 1, 1, 'Massive Kreatur aus Fels'),
(14, 'Sturm-Elemental', 180, 22, 90, 3, 3, 'Blitz und Donner in Form'),
(14, 'Kristall-Elemental', 220, 24, 130, 2, 2, 'Wesen aus purem Kristall'),
(14, 'Ur-Elemental', 300, 32, 150, 2, 3, 'Verschmelzung aller Elemente');

-- ==================================================
-- RASSE 15: BESTIEN (Wilde Kreaturen)
-- ==================================================
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(15, 'Waldwolf', 70, 12, 60, 3, 1, 'Reißzahn des Waldes'),
(15, 'Riesenbär', 120, 20, 100, 2, 1, 'Mächtiger Waldbewohner'),
(15, 'Säbelzahntiger', 140, 22, 80, 3, 1, 'Urzeitlicher Jäger'),
(15, 'Riesenadler', 110, 16, 70, 5, 1, 'Herrscher der Lüfte'),
(15, 'Höhlenbär', 160, 24, 130, 2, 1, 'Bär aus tiefen Höhlen'),
(15, 'Mammut', 200, 28, 150, 2, 1, 'Urzeitlicher Riese'),
(15, 'Rudel-Alpha', 180, 26, 90, 3, 1, 'Anführer des Wolfsrudels'),
(15, 'Riesenspinne', 150, 18, 85, 2, 1, 'Giftiger Achtbeiner'),
(15, 'Urdrache', 280, 35, 140, 4, 2, 'Wilder unzivilisierter Drache'),
(15, 'Bestien-König', 350, 40, 180, 3, 1, 'Herrscher aller wilden Kreaturen');

