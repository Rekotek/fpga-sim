// Урок 5: цепочка из трёх триггеров (опыт «<= против =»).
// Кнопка S1 → q1 → q2 → q3, сдвиг два раза в секунду. q1..q3 видны на LED0..LED2.
// Нажмите S1 на полсекунды: огонёк пройдёт LED0 → LED1 → LED2.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88, нажата = 1
    output wire [2:0] led       // LED0..LED2, выводы 15..17, горят при 0
);
    // Делитель: тик раз в 0,5 с. Считаем 0..LAST, это CLK_HZ / 2 тактов.
    localparam integer LAST = CLK_HZ / 2 - 1;   // 13 499 999 при 27 МГц → 24 бита

    reg  [23:0] div = 24'd0;
    wire        tick = (div == LAST);           // 1 ровно на один такт из 13,5 млн

    always @(posedge clk) begin
        if (tick) div <= 24'd0;
        else      div <= div + 1'b1;
    end

    // Цепочка: на каждом тике каждый триггер берёт значение соседа слева.
    reg q1 = 1'b0, q2 = 1'b0, q3 = 1'b0;

    always @(posedge clk) begin
        if (tick) begin
            q1 <= btn_s1;
            q2 <= q1;
            q3 <= q2;
        end
    end

    assign led = ~{q3, q2, q1};   // led[0] = q1; светодиоды горят по нулю
endmodule
