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

-- Beispiel Einheiten für Menschen (Race ID 1)
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(1, 'Krieger', 80, 15, 80, 2, 1, 'Grundlegender Nahkämpfer'),
(1, 'Bogenschütze', 100, 12, 60, 2, 3, 'Fernkämpfer mit hoher Reichweite'),
(1, 'Ritter', 150, 20, 120, 3, 1, 'Schwer gepanzerter Kavallerist'),
(1, 'Magier', 200, 25, 50, 2, 2, 'Mächtiger Zauberer'),
(1, 'Späher', 60, 8, 40, 4, 1, 'Schnelle Aufklärungseinheit'),
(1, 'Kleriker', 120, 10, 70, 2, 1, 'Heilende Unterstützungseinheit'),
(1, 'Balliste', 250, 35, 80, 1, 4, 'Schwere Belagerungswaffe'),
(1, 'Paladin', 300, 28, 150, 2, 1, 'Elitekrieger mit heiligen Kräften'),
(1, 'Assassine', 180, 30, 55, 3, 1, 'Tödlicher Meuchler'),
(1, 'General', 400, 22, 100, 3, 1, 'Befehlshaber, verstärkt nahe Einheiten');

-- Beispiel Einheiten für Elfen (Race ID 2)
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(2, 'Waldläufer', 90, 14, 70, 3, 2, 'Wendiger Kundschafter'),
(2, 'Elfenmagier', 180, 28, 45, 2, 3, 'Meister der Naturmagie'),
(2, 'Baumhirte', 200, 18, 140, 1, 1, 'Lebender Baum als Beschützer'),
(2, 'Einhornreiter', 220, 20, 90, 4, 1, 'Magischer berittener Kämpfer'),
(2, 'Mondpriesterin', 160, 15, 80, 2, 2, 'Heilerin mit Mondmagie'),
(2, 'Sturmfalke', 120, 16, 50, 5, 1, 'Schnelle fliegende Einheit'),
(2, 'Elfenherr', 350, 25, 110, 3, 1, 'Adeliger Elfenanführer'),
(2, 'Dryade', 140, 12, 85, 2, 1, 'Waldgeist mit Naturkräften'),
(2, 'Sternenschütze', 130, 20, 65, 2, 4, 'Präziser Fernkämpfer'),
(2, 'Phönix', 450, 35, 120, 4, 2, 'Legendärer Feuervogel');

-- Beispiel für weitere Rassen (vereinfacht für Zwerge)
INSERT INTO units (race_id, name, cost, attack_power, health, movement_points, attack_range, description) VALUES
(3, 'Zwergenkämpfer', 100, 18, 100, 1, 1, 'Robuster Nahkämpfer'),
(3, 'Armbrustschütze', 110, 16, 80, 1, 3, 'Präziser Fernkämpfer'),
(3, 'Berserker', 160, 25, 90, 2, 1, 'Wilder Krieger im Kampfrausch'),
(3, 'Minenarbeiter', 80, 10, 120, 1, 1, 'Kann Befestigungen errichten'),
(3, 'Hammergarde', 180, 22, 130, 1, 1, 'Elite-Leibwächter'),
(3, 'Runenmagier', 200, 20, 70, 2, 2, 'Magier mit Runenzauber'),
(3, 'Kriegsmaschine', 300, 30, 150, 1, 2, 'Schwere Zwergentechnik'),
(3, 'Steinbrecher', 220, 35, 110, 1, 1, 'Spezialist gegen Gebäude'),
(3, 'Schildwall', 140, 12, 160, 1, 1, 'Defensive Einheit'),
(3, 'Zwergenkönig', 400, 28, 180, 2, 1, 'Mächtiger Herrscher');