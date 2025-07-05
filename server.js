// 1. Importar las librerías necesarias
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // Necesario para la creación de la carpeta de uploads

// --- CONFIGURACIÓN INICIAL DEL SERVIDOR ---
const app = express(); // Crea la aplicación del servidor (¡solo una vez!)
const PORT = 3000; // El puerto donde se ejecutará nuestro servidor
const dbFile = 'documentos.db'; // Nombre del archivo de nuestra base de datos

// --- MIDDLEWARES GLOBALES ---
// Habilita CORS para permitir peticiones desde tu página web
app.use(cors());

// Habilita que Express pueda leer y entender datos en formato JSON que vienen en las peticiones.
// Esto es VITAL para que funcione el login y otras peticiones POST/PUT.
app.use(express.json());

// Sirve los archivos PDF estáticamente desde la carpeta 'uploads'.
// Primero, asegura que la carpeta 'uploads' exista.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// --- SEGURIDAD: LA CONTRASEÑA CORRECTA ---
// La contraseña correcta ahora vive aquí, segura en el servidor.
const LA_CONTRASEÑA_CORRECTA = "Fiscal2025";

// --- CONEXIÓN A LA BASE DE DATOS SQLITE ---
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        // Crear la tabla si no existe
        db.run(`CREATE TABLE IF NOT EXISTS documentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL UNIQUE,
            filepath TEXT NOT NULL,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, (createErr) => {
            if (createErr) {
                console.error('Error al crear la tabla documentos:', createErr.message);
            } else {
                console.log('Tabla "documentos" asegurada/creada.');
            }
        });
    }
});

// --- CONFIGURACIÓN DE MULTER PARA LA SUBIDA DE ARCHIVOS ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // La carpeta donde se guardarán los archivos
    },
    filename: function (req, file, cb) {
        // Usamos el nombre original del archivo. Se recomienda añadir un timestamp
        // o un UUID para evitar conflictos de nombres en una app real.
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- RUTAS DE LA API (Los "endpoints" con los que se comunicará el frontend) ---

// [POST] Endpoint para el Login
app.post('/api/login', (req, res) => {
    // Gracias a `app.use(express.json())`, podemos leer la contraseña enviada.
    const { password } = req.body;

    console.log(`Intento de login con la contraseña: ${password}`);

    // Comparamos la contraseña que nos llegó con la correcta
    if (password === LA_CONTRASEÑA_CORRECTA) {
        // SI ES CORRECTA:
        // Enviamos una respuesta de éxito (código 200) con un mensaje.
        console.log("Login exitoso.");
        res.status(200).json({ message: 'Login exitoso' });
    } else {
        // SI ES INCORRECTA:
        // Enviamos una respuesta de error (código 401 Unauthorized) con un mensaje.
        console.log("Contraseña incorrecta.");
        res.status(401).json({ message: 'Contraseña incorrecta. Inténtalo de nuevo.' });
    }
});

// [GET] Obtener todos los documentos
app.get('/api/documentos', (req, res) => {
    db.all("SELECT id, filename, filepath, upload_date FROM documentos ORDER BY filename", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ documents: rows });
    });
});

// [POST] Subir un nuevo documento
app.post('/api/upload', upload.single('pdfFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo.' });
    }

    const filename = req.file.originalname;
    const filepath = `/uploads/${filename}`; // La ruta para acceder al archivo desde la web

    // Usamos INSERT OR IGNORE para no insertar un archivo si ya existe uno con el mismo nombre.
    const sql = 'INSERT OR IGNORE INTO documentos (filename, filepath) VALUES (?, ?)';
    db.run(sql, [filename, filepath], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        // Si this.changes es 0, significa que el archivo ya existía y no se insertó.
        if (this.changes === 0) {
            return res.status(409).json({ message: 'El archivo ya existe.', alreadyExists: true });
        }
        res.status(201).json({ message: 'Archivo subido y guardado con éxito!', filename: filename });
    });
});

// [DELETE] Eliminar un documento por su nombre
app.delete('/api/documentos/:filename', (req, res) => {
    const filename = req.params.filename;
    const sql = 'DELETE FROM documentos WHERE filename = ?';

    db.run(sql, filename, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ message: 'Documento no encontrado.' });
        }

        // Opcional: Borrar el archivo físico del sistema de archivos
        const filePathToDelete = path.join(uploadsDir, filename);
        fs.unlink(filePathToDelete, (unlinkErr) => {
            if (unlinkErr) {
                console.error(`Error al borrar el archivo físico ${filename}:`, unlinkErr.message);
                // No devolvemos un error al cliente si la DB se actualizó correctamente.
                // Podríamos registrarlo o añadir un flag al mensaje.
            } else {
                console.log(`Archivo físico ${filename} eliminado.`);
            }
            res.json({ message: `Documento "${filename}" eliminado de la base de datos y archivo físico.` });
        });
    });
});

// [DELETE] Eliminar TODOS los documentos
app.delete('/api/documentos', (req, res) => {
    db.run('DELETE FROM documentos', [], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        // Opcional: Borrar todos los archivos de la carpeta 'uploads'
        fs.readdir(uploadsDir, (err, files) => {
            if (err) {
                console.error('Error al leer la carpeta de uploads para borrar archivos:', err.message);
                return res.json({ message: 'Documentos eliminados de la DB, pero hubo un error al borrar archivos físicos.' });
            }

            if (files.length === 0) {
                return res.json({ message: 'No hay documentos para eliminar.' });
            }

            let filesDeleted = 0;
            files.forEach(file => {
                const filePath = path.join(uploadsDir, file);
                fs.unlink(filePath, (unlinkErr) => {
                    if (unlinkErr) {
                        console.error(`Error al borrar el archivo físico ${file}:`, unlinkErr.message);
                    } else {
                        filesDeleted++;
                        console.log(`Archivo físico ${file} eliminado.`);
                    }
                    if (filesDeleted === files.length) { // Solo responder una vez que todos los archivos se han intentado eliminar
                         res.json({ message: `Todos los documentos (${this.changes} entradas de la DB) y ${filesDeleted} archivos físicos han sido eliminados.` });
                    }
                });
            });
        });
    });
});

// [GET] Buscar documentos
app.get('/api/search/:term', (req, res) => {
    const term = req.params.term;
    const sql = "SELECT id, filename, filepath, upload_date FROM documentos WHERE filename LIKE ?";
    db.all(sql, [`%${term}%`], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ documents: rows });
    });
});

// 7. Iniciar el servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});