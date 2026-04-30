//! STEP ISO 10303-21 (Part 21) parser (Phase G Stage 4-B, ADR-035 P20.2).
//!
//! Token stream (from `step_lexer`) → structured AST:
//! - `StepFile { header: Vec<Entity>, data: HashMap<u32, Entity> }`
//! - `Entity { tag: String, args: Vec<Value> }`
//! - `Value` — argument 의 union (Ref / Int / Float / Str / Enum /
//!   List / Null / Derived / TypedRef / Nested entity)
//!
//! ## File grammar (per ISO 10303-21 §7)
//!
//! ```text
//! file        ::= "ISO-10303-21;" header data "END-ISO-10303-21;"
//! header      ::= "HEADER;" header_entity* "ENDSEC;"
//! data        ::= "DATA;" entity_assignment* "ENDSEC;"
//! header_entity      ::= simple_entity ";"
//! entity_assignment  ::= entity_id "=" simple_entity ";"
//! simple_entity      ::= keyword "(" args ")"
//! args        ::= ε | value ("," value)*
//! value       ::= ref | int | float | string | enum | list | "$" | "*"
//!               | typed_ref      ; e.g. POSITIVE_LENGTH_MEASURE(1.0)
//! list        ::= "(" value-list ")"
//! ```
//!
//! ## ISO-10303-21 prefix handling
//!
//! 일부 파일은 `ISO-10303-21;` 같은 magic header 가 hyphen 을 포함하는데
//! 이는 lexer 가 처리 못 함 → parser 가 byte 단위 prefix scan 으로 우회.

use std::collections::HashMap;

use crate::step_lexer::{LexError, LocatedToken, Position, Token, tokenize};

// ────────────────────────────────────────────────────────────────────────
// AST
// ────────────────────────────────────────────────────────────────────────

/// Argument value — STEP entity argument 의 union.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// `#N` entity reference.
    Ref(u32),
    /// Integer literal.
    Int(i64),
    /// Float literal.
    Float(f64),
    /// String literal (escape resolved).
    Str(String),
    /// `.IDENT.` enum.
    Enum(String),
    /// `(value, value, ...)` list.
    List(Vec<Value>),
    /// `$` — null / unset.
    Null,
    /// `*` — derived attribute.
    Derived,
    /// Typed reference like `POSITIVE_LENGTH_MEASURE(1.0)` — embeds another
    /// entity-like value. `tag` + single arg.
    Typed { tag: String, args: Vec<Value> },
}

impl Value {
    /// As Float (with auto Int → f64 coercion). Returns None if not numeric.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Float(f) => Some(*f),
            Value::Int(i) => Some(*i as f64),
            _ => None,
        }
    }

    /// As Ref (returns None if not a ref).
    pub fn as_ref(&self) -> Option<u32> {
        match self {
            Value::Ref(n) => Some(*n),
            _ => None,
        }
    }

    /// As List (returns None if not a list).
    pub fn as_list(&self) -> Option<&[Value]> {
        match self {
            Value::List(v) => Some(v),
            _ => None,
        }
    }

    /// As String (returns None if not a string).
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    /// As Enum identifier.
    pub fn as_enum(&self) -> Option<&str> {
        match self {
            Value::Enum(s) => Some(s),
            _ => None,
        }
    }
}

/// One STEP entity (e.g. `LINE('', #1, #2)`).
#[derive(Clone, Debug, PartialEq)]
pub struct Entity {
    pub tag: String,
    pub args: Vec<Value>,
}

/// Parsed STEP file.
#[derive(Clone, Debug, Default)]
pub struct StepFile {
    /// HEADER section entities (no `#N` prefix).
    pub header: Vec<Entity>,
    /// DATA section entities, keyed by `#N`.
    pub data: HashMap<u32, Entity>,
}

impl StepFile {
    pub fn header_entity(&self, tag: &str) -> Option<&Entity> {
        self.header.iter().find(|e| e.tag == tag)
    }

    pub fn entity(&self, id: u32) -> Option<&Entity> {
        self.data.get(&id)
    }

    /// Iterate (id, entity) in DATA section.
    pub fn iter_entities(&self) -> impl Iterator<Item = (&u32, &Entity)> {
        self.data.iter()
    }
}

// ────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ParseError {
    pub message: String,
    pub pos: Option<Position>,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.pos {
            Some(p) => write!(f, "STEP parse error at {}: {}", p, self.message),
            None => write!(f, "STEP parse error: {}", self.message),
        }
    }
}

impl std::error::Error for ParseError {}

impl From<LexError> for ParseError {
    fn from(e: LexError) -> Self {
        ParseError { message: e.message, pos: Some(e.pos) }
    }
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/// Parse STEP ASCII text → `StepFile`.
pub fn parse(src: &str) -> Result<StepFile, ParseError> {
    // Strip ISO-10303-21 envelope if present — lexer can't handle hyphens
    // in `ISO-10303-21;` and `END-ISO-10303-21;`.
    let stripped = strip_iso_envelope(src);
    let tokens = tokenize(stripped)?;
    let mut p = Parser::new(tokens);
    p.parse_file()
}

fn strip_iso_envelope(src: &str) -> &str {
    // Skip leading whitespace + optional "ISO-10303-21;" prefix.
    let trimmed = src.trim_start();
    let after_prefix = if let Some(rest) = trimmed.strip_prefix("ISO-10303-21;") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("ISO-10303-21 ;") {
        rest
    } else {
        trimmed
    };

    // Strip trailing "END-ISO-10303-21;" + optional trailing whitespace.
    let trimmed_end = after_prefix.trim_end();
    let before_suffix = if let Some(stripped) = trimmed_end.strip_suffix("END-ISO-10303-21;") {
        stripped
    } else if let Some(stripped) = trimmed_end.strip_suffix("END-ISO-10303-21 ;") {
        stripped
    } else {
        trimmed_end
    };
    before_suffix
}

// ────────────────────────────────────────────────────────────────────────
// Parser
// ────────────────────────────────────────────────────────────────────────

struct Parser {
    tokens: Vec<LocatedToken>,
    pos: usize,
}

impl Parser {
    fn new(tokens: Vec<LocatedToken>) -> Self {
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.pos.min(self.tokens.len() - 1)].token
    }

    fn peek_pos(&self) -> Position {
        self.tokens[self.pos.min(self.tokens.len() - 1)].pos
    }

    fn advance(&mut self) -> &LocatedToken {
        let i = self.pos;
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        &self.tokens[i]
    }

    fn expect(&mut self, expected: &Token, label: &str) -> Result<&LocatedToken, ParseError> {
        let pos = self.peek_pos();
        if std::mem::discriminant(self.peek()) == std::mem::discriminant(expected) {
            Ok(self.advance())
        } else {
            Err(ParseError {
                message: format!("expected {}, got {:?}", label, self.peek()),
                pos: Some(pos),
            })
        }
    }

    fn match_tag(&mut self, name: &str) -> bool {
        if let Token::Tag(t) = self.peek() {
            if t == name {
                self.advance();
                return true;
            }
        }
        false
    }

    fn parse_file(&mut self) -> Result<StepFile, ParseError> {
        let mut file = StepFile::default();

        // HEADER ;
        if !self.match_tag("HEADER") {
            return Err(ParseError {
                message: "expected HEADER section".to_string(),
                pos: Some(self.peek_pos()),
            });
        }
        self.expect(&Token::Semicolon, "';' after HEADER")?;
        while !self.match_tag("ENDSEC") {
            let ent = self.parse_simple_entity()?;
            self.expect(&Token::Semicolon, "';' after header entity")?;
            file.header.push(ent);
        }
        self.expect(&Token::Semicolon, "';' after ENDSEC")?;

        // DATA ;
        if !self.match_tag("DATA") {
            return Err(ParseError {
                message: "expected DATA section".to_string(),
                pos: Some(self.peek_pos()),
            });
        }
        self.expect(&Token::Semicolon, "';' after DATA")?;
        while !self.match_tag("ENDSEC") {
            self.parse_entity_assignment(&mut file)?;
        }
        self.expect(&Token::Semicolon, "';' after ENDSEC")?;

        // Optional END-ISO-10303-21; trailer — lexer can't handle hyphens, so
        // we just stop on EOF (anything after ENDSEC; is ignored).

        Ok(file)
    }

    fn parse_entity_assignment(&mut self, file: &mut StepFile) -> Result<(), ParseError> {
        let pos = self.peek_pos();
        let id = match self.advance().token.clone() {
            Token::Ref(n) => n,
            other => return Err(ParseError {
                message: format!("expected entity ref '#N', got {:?}", other),
                pos: Some(pos),
            }),
        };
        self.expect(&Token::Equals, "'=' after entity ref")?;
        let entity = self.parse_simple_entity()?;
        self.expect(&Token::Semicolon, "';' after entity assignment")?;
        if file.data.insert(id, entity).is_some() {
            return Err(ParseError {
                message: format!("duplicate entity id #{}", id),
                pos: Some(pos),
            });
        }
        Ok(())
    }

    fn parse_simple_entity(&mut self) -> Result<Entity, ParseError> {
        let pos = self.peek_pos();
        let tag = match self.advance().token.clone() {
            Token::Tag(t) => t,
            other => return Err(ParseError {
                message: format!("expected entity tag, got {:?}", other),
                pos: Some(pos),
            }),
        };
        self.expect(&Token::LParen, "'(' after entity tag")?;
        let args = self.parse_arg_list()?;
        self.expect(&Token::RParen, "')' after entity args")?;
        Ok(Entity { tag, args })
    }

    fn parse_arg_list(&mut self) -> Result<Vec<Value>, ParseError> {
        let mut args = Vec::new();
        if matches!(self.peek(), Token::RParen) {
            return Ok(args);
        }
        loop {
            args.push(self.parse_value()?);
            match self.peek() {
                Token::Comma => { self.advance(); }
                _ => break,
            }
        }
        Ok(args)
    }

    fn parse_value(&mut self) -> Result<Value, ParseError> {
        let pos = self.peek_pos();
        match self.peek().clone() {
            Token::Ref(n) => { self.advance(); Ok(Value::Ref(n)) }
            Token::Int(i) => { self.advance(); Ok(Value::Int(i)) }
            Token::Float(f) => { self.advance(); Ok(Value::Float(f)) }
            Token::Str(s) => { self.advance(); Ok(Value::Str(s)) }
            Token::Enum(e) => { self.advance(); Ok(Value::Enum(e)) }
            Token::Dollar => { self.advance(); Ok(Value::Null) }
            Token::Asterisk => { self.advance(); Ok(Value::Derived) }
            Token::LParen => {
                self.advance();
                let inner = self.parse_arg_list()?;
                self.expect(&Token::RParen, "')' after value list")?;
                Ok(Value::List(inner))
            }
            Token::Tag(tag) => {
                // Typed reference (e.g. POSITIVE_LENGTH_MEASURE(1.0))
                self.advance();
                self.expect(&Token::LParen, "'(' after typed value tag")?;
                let inner = self.parse_arg_list()?;
                self.expect(&Token::RParen, "')' after typed value args")?;
                Ok(Value::Typed { tag, args: inner })
            }
            other => Err(ParseError {
                message: format!("unexpected token in value position: {:?}", other),
                pos: Some(pos),
            }),
        }
    }
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_file(data_body: &str) -> String {
        format!(
            "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('test'),'2;1');\nENDSEC;\nDATA;\n{}\nENDSEC;\nEND-ISO-10303-21;\n",
            data_body
        )
    }

    #[test]
    fn parse_minimal_file_succeeds() {
        let src = minimal_file("");
        let f = parse(&src).unwrap();
        assert_eq!(f.header.len(), 1);
        assert_eq!(f.header[0].tag, "FILE_DESCRIPTION");
        assert!(f.data.is_empty());
    }

    #[test]
    fn parse_single_cartesian_point() {
        let src = minimal_file("#1 = CARTESIAN_POINT('', (0., 0., 0.));");
        let f = parse(&src).unwrap();
        let pt = f.entity(1).expect("entity #1 missing");
        assert_eq!(pt.tag, "CARTESIAN_POINT");
        assert_eq!(pt.args.len(), 2);
        assert_eq!(pt.args[0], Value::Str("".to_string()));
        match &pt.args[1] {
            Value::List(coords) => {
                assert_eq!(coords.len(), 3);
                for c in coords { assert_eq!(c, &Value::Float(0.0)); }
            }
            other => panic!("expected list, got {:?}", other),
        }
    }

    #[test]
    fn parse_line_with_refs() {
        let src = minimal_file(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#2 = DIRECTION('', (1., 0., 0.));\n",
            "#3 = VECTOR('', #2, 1.0);\n",
            "#4 = LINE('', #1, #3);"
        ));
        let f = parse(&src).unwrap();
        assert_eq!(f.data.len(), 4);
        let line = f.entity(4).unwrap();
        assert_eq!(line.tag, "LINE");
        assert_eq!(line.args[1], Value::Ref(1));
        assert_eq!(line.args[2], Value::Ref(3));
    }

    #[test]
    fn parse_null_and_derived_args() {
        let src = minimal_file("#1 = ADVANCED_FACE('', $, *, .T.);");
        let f = parse(&src).unwrap();
        let af = f.entity(1).unwrap();
        assert_eq!(af.args, vec![
            Value::Str("".to_string()),
            Value::Null,
            Value::Derived,
            Value::Enum("T".to_string()),
        ]);
    }

    #[test]
    fn parse_typed_value() {
        // POSITIVE_LENGTH_MEASURE(1.0) is a typed reference inline.
        let src = minimal_file(
            "#1 = B_SPLINE_CURVE_WITH_KNOTS('', POSITIVE_LENGTH_MEASURE(1.0), (#2, #3));"
        );
        let f = parse(&src).unwrap();
        let ent = f.entity(1).unwrap();
        match &ent.args[1] {
            Value::Typed { tag, args } => {
                assert_eq!(tag, "POSITIVE_LENGTH_MEASURE");
                assert_eq!(args, &[Value::Float(1.0)]);
            }
            other => panic!("expected Typed value, got {:?}", other),
        }
        // 3rd arg = list of refs
        match &ent.args[2] {
            Value::List(items) => {
                assert_eq!(items, &[Value::Ref(2), Value::Ref(3)]);
            }
            other => panic!("expected list, got {:?}", other),
        }
    }

    #[test]
    fn parse_multiple_header_entities() {
        let src = "ISO-10303-21;\nHEADER;\n\
            FILE_DESCRIPTION(('a'),'2;1');\n\
            FILE_NAME('cube.stp','2026-04-30',(''),(''),'auto','test','');\n\
            FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));\n\
            ENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
        let f = parse(src).unwrap();
        assert_eq!(f.header.len(), 3);
        let schema = f.header_entity("FILE_SCHEMA").unwrap();
        match &schema.args[0] {
            Value::List(items) => {
                assert_eq!(items, &[Value::Str("CONFIG_CONTROL_DESIGN".to_string())]);
            }
            other => panic!("expected list, got {:?}", other),
        }
    }

    #[test]
    fn parse_duplicate_entity_id_errors() {
        let src = minimal_file(concat!(
            "#1 = CARTESIAN_POINT('', (0., 0., 0.));\n",
            "#1 = CARTESIAN_POINT('', (1., 2., 3.));"
        ));
        let result = parse(&src);
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("duplicate"));
    }

    #[test]
    fn parse_missing_header_errors() {
        let src = "ISO-10303-21;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
        let result = parse(src);
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("HEADER"));
    }

    #[test]
    fn parse_missing_data_errors() {
        let src = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nENDSEC;\nEND-ISO-10303-21;\n";
        let result = parse(src);
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("DATA"));
    }

    #[test]
    fn iso_prefix_optional() {
        // Same content without the ISO-10303-21; prefix.
        let src = "HEADER;\nFILE_DESCRIPTION(('x'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\n";
        let f = parse(src).unwrap();
        assert_eq!(f.header.len(), 1);
    }

    #[test]
    fn empty_arg_list() {
        let src = minimal_file("#1 = SOMETHING();");
        let f = parse(&src).unwrap();
        let e = f.entity(1).unwrap();
        assert!(e.args.is_empty());
    }

    #[test]
    fn nested_list_args() {
        // Knot multiplicities like ((1, 2, 3), (4, 5, 6))
        let src = minimal_file("#1 = NESTED('', ((1, 2, 3), (4, 5)));");
        let f = parse(&src).unwrap();
        let e = f.entity(1).unwrap();
        match &e.args[1] {
            Value::List(outer) => {
                assert_eq!(outer.len(), 2);
                match &outer[0] {
                    Value::List(inner) => assert_eq!(inner.len(), 3),
                    _ => panic!("expected inner list"),
                }
            }
            _ => panic!("expected outer list"),
        }
    }

    #[test]
    fn value_helpers_work() {
        assert_eq!(Value::Float(1.5).as_f64(), Some(1.5));
        assert_eq!(Value::Int(2).as_f64(), Some(2.0));
        assert_eq!(Value::Str("x".into()).as_f64(), None);
        assert_eq!(Value::Ref(7).as_ref(), Some(7));
        assert_eq!(Value::Int(0).as_ref(), None);
        assert_eq!(Value::Str("hi".into()).as_str(), Some("hi"));
        assert_eq!(Value::Enum("T".into()).as_enum(), Some("T"));
    }

    #[test]
    fn realistic_step_fragment() {
        // 미니멀 cube fragment — 8 vertices + 12 edges + 6 faces 까지는 후속.
        // 본 테스트는 파서가 다양한 entity 패턴을 견디는지 검증.
        let src = "ISO-10303-21;\n\
            HEADER;\n\
            FILE_DESCRIPTION(('cube'),'2;1');\n\
            FILE_NAME('cube.stp','2026-04-30',(''),(''),'AXiA','test','');\n\
            FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));\n\
            ENDSEC;\n\
            DATA;\n\
            #1 = CARTESIAN_POINT('', (0., 0., 0.));\n\
            #2 = CARTESIAN_POINT('', (1., 0., 0.));\n\
            #3 = DIRECTION('', (1., 0., 0.));\n\
            #4 = DIRECTION('', (0., 0., 1.));\n\
            #5 = AXIS2_PLACEMENT_3D('', #1, #4, #3);\n\
            #6 = VECTOR('', #3, 1.0);\n\
            #7 = LINE('', #1, #6);\n\
            ENDSEC;\n\
            END-ISO-10303-21;\n";
        let f = parse(src).unwrap();
        assert_eq!(f.header.len(), 3);
        assert_eq!(f.data.len(), 7);
        assert_eq!(f.entity(7).unwrap().tag, "LINE");
        assert_eq!(f.entity(5).unwrap().tag, "AXIS2_PLACEMENT_3D");
    }
}
